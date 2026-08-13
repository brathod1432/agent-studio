// `agents` CLI command. The specialized agents live in the shared top-level
// agents/ catalog and are EXECUTED by the Python runtime; this command drives
// them over the stdio bridge. @file references are expanded (with the usual
// workspace/secret guards) before the task is sent.

import { createPythonBridge } from '../../engine/index.ts';
import { applyFileContext } from './context.ts';

function parseFlags(argv: string[]): { rest: string[]; json: boolean; allowAny: boolean } {
  const rest: string[] = [];
  let json = false;
  let allowAny = false;
  for (const a of argv) {
    if (a === '--json') json = true;
    else if (a === '--allow-any-file') allowAny = true;
    else rest.push(a);
  }
  return { rest, json, allowAny };
}

export async function runAgents(argv: string[]): Promise<void> {
  const { rest, json, allowAny } = parseFlags(argv);
  const action = rest[0] ?? 'list';
  // Agentic agents call an LLM, which can take a while — use a generous timeout.
  const bridge = createPythonBridge({ timeoutMs: 180000 });
  try {
    if (action === 'list') {
      const agents = await bridge.listAgents();
      for (const a of agents) {
        console.log(`  ${a.id}  [${a.workflow}]  —  ${a.name}`);
        console.log(`      ${a.description}`);
      }
      return;
    }

    if (action === 'show') {
      const id = rest[1];
      if (!id) return usage();
      const a = await bridge.describeAgent(id);
      console.log(`# ${a.name}  (${a.id})`);
      console.log(`${a.description}\n`);
      console.log(`Workflow:  ${a.workflow}${a.pipeline ? ` (${a.pipeline})` : ''}`);
      console.log(`Tools:     ${a.tools.join(', ') || '(none)'}`);
      console.log(
        `Policy:    readOnly=${a.policy.readOnly}, autoApprove=${a.policy.autoApprove}, maxSteps=${a.policy.maxSteps}`,
      );
      console.log(`\nPrompt:\n${a.prompt}`);
      return;
    }

    if (action === 'run') {
      const id = rest[1];
      if (!id) return usage();
      const rawTask = rest.slice(2).join(' ').trim();
      if (!rawTask) {
        console.error(`Usage: agent-studio agents run ${id} <task-or-path>`);
        process.exitCode = 2;
        return;
      }
      // Expand @file locally (guarded) so agentic agents get file context.
      const task = applyFileContext(rawTask, (line) => console.error(line), { allowAny });
      const result = await bridge.runAgent(id, task);
      if (json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }
      console.log(result.content);
      if (result.workflow === 'agentic') {
        console.log(`\n[agent] ${result.toolCallsMade} tool call(s), ${result.steps} step(s)`);
      }
      return;
    }

    usage();
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    bridge.close();
  }
}

function usage(): void {
  console.log('Usage: agent-studio agents [list | show <id> | run <id> <task>] [--json]');
  process.exitCode = 2;
}
