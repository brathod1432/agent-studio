// Bridge from the TypeScript engine to the Python tool host over stdio
// (newline-delimited JSON-RPC). The Python runtime is a process-isolated,
// least-privilege extension: it is spawned on demand, communicates only via
// stdin/stdout, and holds no policy of its own.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface PythonBridgeOptions {
  /** Python executable (default: env AGENT_STUDIO_PYTHON or "python"). */
  python?: string;
  /** Working dir that makes `agent_studio` importable (default: <repo>/src/py). */
  cwd?: string;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function repoRoot(): string {
  // src/engine/bridge/pythonBridge.ts -> up three to the repo root.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..');
}

export class PythonBridge {
  #proc: ChildProcessWithoutNullStreams | null = null;
  #opts: Required<Omit<PythonBridgeOptions, 'env'>> & { env: NodeJS.ProcessEnv };
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #buf = '';
  #stderr = '';
  #exited?: { code: number | null; signal: NodeJS.Signals | null };

  constructor(options: PythonBridgeOptions = {}) {
    const env = options.env ?? process.env;
    this.#opts = {
      python: options.python ?? env.AGENT_STUDIO_PYTHON ?? 'python',
      cwd: options.cwd ?? join(repoRoot(), 'src', 'py'),
      timeoutMs: options.timeoutMs ?? 30000,
      env,
    };
  }

  #start(): ChildProcessWithoutNullStreams {
    if (this.#proc) return this.#proc;
    const proc = spawn(this.#opts.python, ['-m', 'agent_studio.rpc.host'], {
      cwd: this.#opts.cwd,
      env: this.#opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.#onData(chunk));
    proc.stderr.on('data', (chunk: string) => {
      this.#stderr += chunk;
    });
    proc.on('error', (err) => this.#failAll(new Error(`Failed to start Python host: ${err.message}`)));
    proc.on('exit', (code, signal) => {
      this.#exited = { code, signal };
      this.#failAll(new Error(`Python host exited (code ${code}${signal ? `, signal ${signal}` : ''}).`));
      this.#proc = null;
    });
    this.#proc = proc;
    return proc;
  }

  #onData(chunk: string): void {
    this.#buf += chunk;
    let idx: number;
    while ((idx = this.#buf.indexOf('\n')) !== -1) {
      const line = this.#buf.slice(0, idx).trim();
      this.#buf = this.#buf.slice(idx + 1);
      if (!line) continue;
      let msg: { id?: number; result?: unknown; error?: { code: number; message: string } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // ignore non-JSON noise
      }
      if (typeof msg.id !== 'number') continue;
      const pending = this.#pending.get(msg.id);
      if (!pending) continue;
      this.#pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else pending.resolve(msg.result);
    }
  }

  #failAll(err: Error): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.#pending.clear();
  }

  #request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const proc = this.#start();
    const id = this.#nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }) + '\n';
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        rejectPromise(new Error(`Python host request "${method}" timed out after ${this.#opts.timeoutMs}ms.`));
      }, this.#opts.timeoutMs);
      this.#pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      proc.stdin.write(payload);
    });
  }

  async ping(): Promise<{ ok: boolean; version: string }> {
    return (await this.#request('ping')) as { ok: boolean; version: string };
  }

  async listTools(): Promise<ToolDescriptor[]> {
    const result = (await this.#request('tools/list')) as { tools: ToolDescriptor[] };
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.#request('tools/call', { name, arguments: args });
  }

  /** Captured stderr from the host (for diagnostics). */
  get stderr(): string {
    return this.#stderr;
  }

  close(): void {
    if (this.#proc) {
      try {
        this.#proc.stdin.end();
      } catch {
        // ignore
      }
      this.#proc.kill();
      this.#proc = null;
    }
    this.#failAll(new Error('Python bridge closed.'));
  }
}

export function createPythonBridge(options: PythonBridgeOptions = {}): PythonBridge {
  return new PythonBridge(options);
}
