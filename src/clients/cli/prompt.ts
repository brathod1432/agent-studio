// Minimal interactive prompt helpers built on node:readline.
//
// Input lines are buffered in a queue so that piped / scripted input is never
// dropped between prompts (interactive typing behaves identically). The hidden
// prompt masks secret input so an API key is never echoed to the terminal.

import * as readline from 'node:readline';

export interface Prompter {
  ask(query: string, fallback?: string): Promise<string>;
  askHidden(query: string): Promise<string>;
  confirm(query: string, defaultYes?: boolean): Promise<boolean>;
  /**
   * Read one line. Returns null ONLY when there is genuinely no more input
   * (buffer drained and stdin closed) — buffered lines are always returned
   * first, even after EOF.
   */
  readLine(query: string): Promise<string | null>;
  /** True once stdin has reached EOF / the interface has closed. */
  readonly isClosed: boolean;
  /**
   * Register a handler for Ctrl+C (SIGINT). Returns an unsubscribe function.
   * While at least one handler is registered, the default "terminate the
   * process" behavior is suppressed so callers can cancel gracefully.
   */
  onSigint(handler: () => void): () => void;
  close(): void;
}

export function createPrompter(): Prompter {
  // Use terminal mode only for real interactive TTYs. For piped/scripted input,
  // non-terminal mode delivers one reliable 'line' per input line (no drops) and
  // does not echo input (so hidden-input masking is unnecessary there).
  const interactive = Boolean(process.stdin.isTTY);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });

  let closed = false;
  let muted = false;
  const queue: string[] = [];
  let waiter: ((line: string | null) => void) | null = null;

  rl.on('line', (line) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(line);
    } else {
      queue.push(line);
    }
  });
  rl.on('close', () => {
    closed = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(null);
    }
  });

  // Mask echoed characters while reading a hidden value.
  const rlAny = rl as unknown as { _writeToOutput?: (s: string) => void; output: NodeJS.WriteStream };
  const originalWrite = rlAny._writeToOutput?.bind(rl);
  rlAny._writeToOutput = (str: string): void => {
    if (muted) {
      if (str.includes('\n')) rlAny.output.write('\n');
    } else if (originalWrite) {
      originalWrite(str);
    } else {
      rlAny.output.write(str);
    }
  };

  const nextLine = (): Promise<string | null> => {
    if (queue.length > 0) return Promise.resolve(queue.shift() as string);
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      waiter = resolve;
    });
  };

  const ask = async (query: string, fallback?: string): Promise<string> => {
    process.stdout.write(`${query}${fallback ? ` [${fallback}]` : ''}: `);
    const line = await nextLine();
    if (line === null) return fallback ?? '';
    const a = line.trim();
    return a.length ? a : (fallback ?? '');
  };

  const askHidden = async (query: string): Promise<string> => {
    process.stdout.write(`${query}: `);
    muted = true;
    try {
      const line = await nextLine();
      return (line ?? '').trim();
    } finally {
      muted = false;
    }
  };

  const readLine = async (query: string): Promise<string | null> => {
    process.stdout.write(`${query}: `);
    const line = await nextLine();
    return line === null ? null : line.trim();
  };

  const confirm = async (query: string, defaultYes = true): Promise<boolean> => {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    const a = (await ask(`${query} (${hint})`)).toLowerCase();
    if (!a) return defaultYes;
    return a === 'y' || a === 'yes';
  };

  const onSigint = (handler: () => void): (() => void) => {
    // Listen on both the readline interface (raw TTY mode) and the process, so
    // Ctrl+C is caught whether or not readline is actively reading a line.
    rl.on('SIGINT', handler);
    process.on('SIGINT', handler);
    return () => {
      rl.off('SIGINT', handler);
      process.off('SIGINT', handler);
    };
  };

  return {
    ask,
    askHidden,
    confirm,
    readLine,
    get isClosed() {
      return closed;
    },
    onSigint,
    close: () => rl.close(),
  };
}
