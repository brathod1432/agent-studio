// Interactive chat client. Flow:
//   welcome -> select existing OR create new session -> chat loop -> exit
// Commands: /help /new /list /resume /exit
//
// Responses stream live when the provider supports it; memory is auto-saved
// after every assistant reply.

import {
  ChatAgent,
  ConversationStore,
  createLLMClientFromSettings,
  formatError,
  loadCatalog,
  loadSettings,
  ProviderError,
  resolveActiveProvider,
  resolveSecret,
  setActiveModel,
  setActiveProvider,
  type Conversation,
  type ConversationSummary,
  type ResolvedLLM,
} from '../../engine/index.ts';
import { createPrompter, type Prompter } from './prompt.ts';
import { chooseModelId, chooseProviderId } from './config.ts';

const HELP = [
  'Commands:',
  '  /help      Show this help',
  '  /new       Start a new conversation',
  '  /list      List saved conversations',
  '  /resume    Resume a saved conversation',
  '  /model     Change the model (pick from the live list, or /model <id>)',
  '  /provider  Switch provider (/provider, or /provider <id>)',
  '  /exit      Quit',
].join('\n');

function printBanner(): void {
  console.log('==============================================');
  console.log('        Agent Studio — Chat');
  console.log('==============================================');
}

function printSummaries(summaries: ConversationSummary[]): void {
  if (summaries.length === 0) {
    console.log('  (no saved conversations yet)');
    return;
  }
  summaries.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.title}  ·  ${s.messageCount} msgs  ·  ${new Date(s.updatedAt).toLocaleString()}`);
    console.log(`     id: ${s.id}`);
  });
}

function printHistory(conversation: Conversation): void {
  if (conversation.messages.length === 0) return;
  console.log(`\n--- resuming "${conversation.title}" (${conversation.messages.length} messages) ---`);
  for (const m of conversation.messages) {
    const who = m.role === 'user' ? 'you' : m.role;
    console.log(`${who}> ${m.content}`);
  }
  console.log('--- end of history ---\n');
}

export async function runChat(): Promise<void> {
  printBanner();

  // Build the LLM client from the active provider configuration.
  let resolved: ResolvedLLM;
  try {
    resolved = createLLMClientFromSettings({ env: process.env });
  } catch (err) {
    if (err instanceof ProviderError) {
      console.log(`\n${err.message}`);
      console.log('Run "npm run onboard" to configure a provider first.');
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  let { client, config } = resolved;

  // Non-fatal warning if a required key is missing (the first call would fail).
  const warnIfMissingKey = (): void => {
    if (config.apiKeyRef) {
      const envName = config.apiKeyRef.replace(/^env:/, '');
      if (!resolveSecret(config.apiKeyRef, process.env).present) {
        console.log(`Warning: ${envName} is not set. Set it in .env.local before chatting.`);
      }
    }
  };
  warnIfMissingKey();

  console.log(`\nProvider: ${config.label} (${config.id})   Model: ${client.model}`);
  console.log('Type a message, or /help for commands.\n');

  const store = new ConversationStore();
  const prompt = createPrompter();

  const makeAgent = (conversation: Conversation): ChatAgent =>
    new ChatAgent({ llm: client, store, conversation });

  try {
    // Session selection.
    const summaries = store.list();
    let conversation: Conversation;
    if (summaries.length > 0) {
      console.log('Existing conversations:');
      printSummaries(summaries);
      const ans = (await prompt.readLine('\nResume which? (number/id, or Enter for new)')) ?? '';
      const picked = pickConversation(ans, summaries, store);
      conversation = picked ?? store.create({ providerId: config.id, model: client.model });
      if (picked) printHistory(conversation);
      else console.log('\nStarted a new conversation.\n');
    } else {
      conversation = store.create({ providerId: config.id, model: client.model });
      console.log('Started a new conversation.\n');
    }

    let agent = makeAgent(conversation);

    // Rebuild the client/agent from freshly persisted settings (after a
    // /model or /provider switch). The conversation is preserved so history
    // carries over to the new model/provider.
    const rebuild = (): void => {
      const next = createLLMClientFromSettings({ env: process.env });
      client = next.client;
      config = next.config;
      agent = makeAgent(conversation);
    };

    // Chat loop.
    for (;;) {
      const line = await prompt.readLine('you>');
      if (line === null) break; // genuine end of input (EOF, buffer drained)
      const input = line.trim();
      if (!input) continue;

      if (input.startsWith('/')) {
        const [cmd, ...rest] = input.slice(1).split(/\s+/);
        if (cmd === 'exit' || cmd === 'quit') break;
        if (cmd === 'help') {
          console.log(HELP);
          continue;
        }
        if (cmd === 'list') {
          printSummaries(store.list());
          continue;
        }
        if (cmd === 'new') {
          conversation = store.create({ providerId: config.id, model: client.model });
          agent = makeAgent(conversation);
          console.log('Started a new conversation.\n');
          continue;
        }
        if (cmd === 'resume') {
          const list = store.list();
          let target = rest.join(' ').trim();
          if (!target) {
            printSummaries(list);
            target = (await prompt.ask('Resume which? (number/id)')).trim();
          }
          const picked = pickConversation(target, list, store);
          if (!picked) {
            console.log('No matching conversation.');
            continue;
          }
          conversation = picked;
          agent = makeAgent(conversation);
          printHistory(conversation);
          continue;
        }
        if (cmd === 'model') {
          let model = rest.join(' ').trim();
          if (!model) {
            model = (await chooseModelId(prompt, config)) ?? '';
            if (!model) {
              console.log('No change made.\n');
              continue;
            }
          }
          try {
            setActiveModel(model);
            rebuild();
            console.log(`Model is now "${client.model}".\n`);
          } catch (err) {
            console.log(`Could not change model: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          continue;
        }
        if (cmd === 'provider') {
          let providerId = rest.join(' ').trim();
          if (!providerId) {
            providerId = (await chooseProviderId(prompt, loadCatalog(), config.id)) ?? '';
            if (!providerId) {
              console.log('No change made.\n');
              continue;
            }
          }
          try {
            setActiveProvider(providerId);
            rebuild();
            warnIfMissingKey();
            const active = resolveActiveProvider(loadSettings(), loadCatalog());
            console.log(`Provider is now "${config.label}" (${config.id}), model "${client.model}".`);
            if (active && !active.model) {
              console.log('This provider has no model set — use /model to pick one.');
            }
            console.log('');
          } catch (err) {
            console.log(`Could not switch provider: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          continue;
        }
        console.log(`Unknown command: /${cmd}. Type /help.`);
        continue;
      }

      // Regular message — stream the assistant reply and auto-save.
      process.stdout.write('assistant> ');
      try {
        await agent.runStream(input, (delta) => process.stdout.write(delta));
        process.stdout.write('\n\n');
      } catch (err) {
        process.stdout.write('\n');
        if (err instanceof ProviderError) {
          const envName = config.apiKeyRef?.replace(/^env:/, '');
          console.log(formatError(err, envName));
          console.log('');
        } else {
          console.log(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }
    }

    console.log('\nGoodbye. Your conversation was saved automatically.');
  } finally {
    prompt.close();
  }
}

function pickConversation(
  answer: string,
  summaries: ConversationSummary[],
  store: ConversationStore,
): Conversation | undefined {
  const a = answer.trim();
  if (!a) return undefined;
  const byIndex = summaries[Number(a) - 1];
  const id = byIndex?.id ?? summaries.find((s) => s.id === a)?.id;
  if (!id) return undefined;
  return store.tryLoad(id);
}

// Allow prompter type import without unused warnings in erasable syntax.
export type { Prompter };
