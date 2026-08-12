// One-shot `ask` command for scripting and pipelines.
//
//   agent-studio ask "explain this regex"
//   git diff | agent-studio ask "review this change for bugs"
//   echo "summarize" | agent-studio ask
//   agent-studio ask --json "return two facts about the moon"
//
// Prints ONLY the answer (streamed) on stdout — no banners or prompts — so it
// composes cleanly into scripts. With --json it prints a single JSON object
// (answer + model + usage) and never streams. Nothing is persisted (one-shot is
// ephemeral). Exit codes: 0 ok, 1 provider/runtime error, 2 usage error.

import {
  ChatAgent,
  ConversationStore,
  createLLMClientFromSettings,
  formatError,
  ProviderError,
  type ResolvedLLM,
} from '../../engine/index.ts';

export interface AskArgs {
  json: boolean;
  prompt: string;
}

/** Parse `ask` argv (everything after the command). Pure + testable. */
export function parseAskArgs(argv: string[]): AskArgs {
  let json = false;
  const parts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '-m' || a === '--message') continue; // optional prompt marker
    else parts.push(a);
  }
  return { json, prompt: parts.join(' ').trim() };
}

/**
 * Combine an argument prompt with piped stdin. When both are present, the
 * argument is the instruction and stdin is appended as context. Pure + testable.
 */
export function combineInput(promptArg: string, stdin: string): string {
  const arg = promptArg.trim();
  const piped = stdin.replace(/\s+$/, '');
  if (arg && piped) return `${arg}\n\n${piped}`;
  return arg || piped;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function runAsk(argv: string[]): Promise<void> {
  const { json, prompt: promptArg } = parseAskArgs(argv);
  const stdin = await readStdin();
  const input = combineInput(promptArg, stdin);

  if (!input) {
    console.error('Usage: agent-studio ask [--json] "your question"   (or pipe input via stdin)');
    process.exitCode = 2;
    return;
  }

  let resolved: ResolvedLLM;
  try {
    resolved = createLLMClientFromSettings({ env: process.env });
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error(err.message);
      console.error('Run "onboard" to configure a provider first.');
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  const { client, config } = resolved;

  // One-shot is ephemeral: build a throwaway conversation that is never written.
  const store = new ConversationStore({ ephemeral: true });
  const conversation = store.create({ providerId: config.id, model: client.model });
  const agent = new ChatAgent({ llm: client, store, conversation });

  try {
    if (json) {
      const answer = await agent.run(input);
      const out = { model: client.model, answer, usage: agent.lastUsage ?? null };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    } else {
      await agent.runStream(input, (delta) => process.stdout.write(delta));
      process.stdout.write('\n');
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      console.error(formatError(err, config.apiKeyRef?.replace(/^env:/, '')));
    } else {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exitCode = 1;
  }
}
