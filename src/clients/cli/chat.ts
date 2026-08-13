// Interactive chat client. Flow:
//   welcome -> select existing OR create new session -> chat loop -> exit
// Commands: /help /new /list /resume /exit
//
// Responses stream live when the provider supports it; memory is auto-saved
// after every assistant reply.

import { writeFileSync } from 'node:fs';

import {
  addUsage,
  ChatAgent,
  CHAT_SYSTEM,
  ConversationStore,
  conversationToMarkdown,
  createLLMClientFromSettings,
  createPythonBridge,
  defaultExportFilename,
  defaultRegistry,
  runToolLoop,
  toolSchema,
  aliasMap,
  describeSecretKinds,
  detectSecrets,
  formatError,
  loadCatalog,
  loadSettings,
  ProviderError,
  redactSecrets,
  resolveActiveProvider,
  resolveSecret,
  setActiveModel,
  setActiveProvider,
  zeroUsage,
  type Conversation,
  type ConversationSearchResult,
  type ConversationSummary,
  type PythonBridge,
  type RawMessage,
  type ResolvedLLM,
  type TokenUsage,
} from '../../engine/index.ts';
import { createPrompter, type Prompter } from './prompt.ts';
import { chooseModelId, chooseProviderId } from './config.ts';
import { applyFileContext } from './context.ts';

const HELP = [
  'Commands:',
  '  /help      Show this help',
  '  /new       Start a new conversation',
  '  /list      List saved conversations',
  '  /resume    Resume a saved conversation',
  '  /rename    Rename the current conversation (/rename <new title>)',
  '  /delete    Delete a conversation (/delete, or /delete <id>)',
  '  /search    Search saved conversations (/search <query>)',
  '  /export    Export the current conversation to Markdown (/export [path])',
  '  /model     Change the model (pick from the live list, or /model <id>)',
  '  /provider  Switch provider (/provider, or /provider <id>)',
  '  /tools     List built-in tools (run via the Python bridge)',
  '  /run       Run a tool and add its output as context (/run <name> <json>)',
  '  /agent     Toggle agentic tool-calling (/agent on|off)',
  '  /exit      Quit',
  '',
  'Tip: reference a file with @path (e.g. "explain @src/app.ts") to add it as context.',
].join('\n');

function printBanner(): void {
  console.log('==============================================');
  console.log('        Agent Studio — Chat');
  console.log('==============================================');
}

function fmt(n: number | undefined): string {
  return n == null ? '?' : String(n);
}

/** One-line per-turn + session token summary (shown after each reply). */
function formatUsageLine(turn: TokenUsage, estimated: boolean, session: TokenUsage, turns: number): string {
  const approx = estimated ? '~' : '';
  const turnPart = `this turn: prompt ${approx}${fmt(turn.promptTokens)} · completion ${approx}${fmt(
    turn.completionTokens,
  )} · total ${approx}${fmt(turn.totalTokens)}${estimated ? ' (est)' : ''}`;
  const sessionPart = `session: total ${fmt(session.totalTokens)} across ${turns} turn${turns === 1 ? '' : 's'}`;
  return `[tokens] ${turnPart}   ${sessionPart}`;
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

function printSearchResults(results: ConversationSearchResult[]): void {
  if (results.length === 0) {
    console.log('  (no matches)');
    return;
  }
  results.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.title}  ·  ${r.messageCount} msgs  ·  ${new Date(r.updatedAt).toLocaleString()}`);
    if (r.matchedIn === 'message' && r.snippet) console.log(`     match: "${r.snippet}"`);
    else console.log('     match: title');
    console.log(`     id: ${r.id}`);
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

export interface RunChatOptions {
  /** Ephemeral session: nothing is written to disk (--no-save). */
  ephemeral?: boolean;
  /** Relax @file safety guards (read outside the workspace / sensitive files). */
  allowAnyFile?: boolean;
  /** Redact secret-looking content from each message before sending/persisting. */
  redactSecrets?: boolean;
  /** Cap generated tokens per reply (overrides the configured default). */
  maxTokens?: number;
  /** Override the system prompt / persona for the session. */
  system?: string;
  /** Enable agentic tool-calling (model may call tools). */
  agent?: boolean;
  /** Auto-approve tool calls in agent mode (no per-call prompt). */
  autoApprove?: boolean;
  /** Max tool-call steps per turn in agent mode (default 6). */
  maxSteps?: number;
}

export async function runChat(opts: RunChatOptions = {}): Promise<void> {
  printBanner();
  const ephemeral = Boolean(opts.ephemeral);

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
  if (ephemeral) {
    console.log('Ephemeral session (--no-save): nothing will be written to disk.');
  }
  console.log('Type a message, or /help for commands.\n');

  const store = new ConversationStore({ ephemeral });
  const prompt = createPrompter();
  const loadedSettings = loadSettings();
  const maxContextTokens = loadedSettings.maxContextTokens;
  // Effective per-turn output cap: CLI flag wins, else the configured default.
  const maxTokens =
    opts.maxTokens ?? (loadedSettings.maxOutputTokens > 0 ? loadedSettings.maxOutputTokens : undefined);

  const makeAgent = (conversation: Conversation): ChatAgent =>
    new ChatAgent({ llm: client, store, conversation, maxContextTokens, systemPrompt: opts.system });

  // The Python tool host is spawned lazily on first /tools, /run, or agent turn.
  let bridge: PythonBridge | undefined;
  const getBridge = (): PythonBridge => (bridge ??= createPythonBridge());

  // Agentic tool-calling state.
  let agentMode = Boolean(opts.agent);
  const autoApprove = Boolean(opts.autoApprove);
  const maxSteps = opts.maxSteps && opts.maxSteps > 0 ? opts.maxSteps : 6;
  const systemText = opts.system ?? defaultRegistry().get(CHAT_SYSTEM).render({ model: client.model });
  if (agentMode) {
    console.log(`Agent mode ON — the model may call tools (max ${maxSteps} steps/turn).`);
    console.log(`Approval: ${autoApprove ? 'auto' : "you'll be asked per call"}.  Type /agent to toggle.\n`);
  }

  const runAgentTurn = async (conv: Conversation, message: string): Promise<void> => {
    const descriptors = await getBridge().listTools();
    const tools = descriptors.map(toolSchema);
    const alias = aliasMap(descriptors.map((d) => d.name)); // provider-safe -> real
    store.append(conv, { role: 'user', content: message });
    const apiMessages: RawMessage[] = [
      { role: 'system', content: systemText },
      ...conv.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const result = await runToolLoop(
      (msgs, offered) => client.chatWithTools({ messages: msgs, tools: offered, maxTokens }),
      apiMessages,
      tools,
      (name, args) => getBridge().callTool(alias.get(name) ?? name, args),
      {
        approve: autoApprove
          ? undefined
          : (name, args) => prompt.confirm(`  Run tool ${name} with ${JSON.stringify(args)}?`, false),
        onEvent: (kind, detail) => {
          if (kind === 'call') console.log(`  → tool: ${detail}`);
          else if (kind === 'denied') console.log(`  ✗ denied: ${detail}`);
          else if (kind === 'error') console.log(`  ! tool error: ${detail}`);
        },
        maxSteps,
      },
    );
    if (result.content) store.append(conv, { role: 'assistant', content: result.content });
    store.save(conv);
    console.log(`assistant> ${result.content}`);
    const note = result.stoppedReason === 'final' ? '' : ' (stopped at step budget)';
    console.log(`[agent] ${result.toolCallsMade} tool call(s), ${result.steps} step(s)${note}\n`);
  };

  try {
    // Session selection. Ephemeral sessions always start fresh (resuming a
    // saved conversation only to discard new turns would be confusing).
    const summaries = ephemeral ? [] : store.list();
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

    // Running token totals for this CLI session (across turns and model switches).
    let sessionUsage: TokenUsage = zeroUsage();
    let turnCount = 0;

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
        if (cmd === 'rename') {
          const title = rest.join(' ').trim();
          if (!title) {
            console.log('Usage: /rename <new title>\n');
            continue;
          }
          conversation.title = title;
          store.save(conversation);
          console.log(`Renamed to "${title}".${ephemeral ? ' (ephemeral — not persisted)' : ''}\n`);
          continue;
        }
        if (cmd === 'delete') {
          const target = rest.join(' ').trim() || conversation.id;
          if (prompt.isInteractive) {
            const ok = await prompt.confirm(`Delete conversation ${target}?`, false);
            if (!ok) {
              console.log('Not deleted.\n');
              continue;
            }
          }
          const deleted = store.delete(target);
          console.log(deleted ? 'Deleted.' : 'No matching conversation.');
          if (deleted && target === conversation.id) {
            conversation = store.create({ providerId: config.id, model: client.model });
            agent = makeAgent(conversation);
            console.log('Started a new conversation.');
          }
          console.log('');
          continue;
        }
        if (cmd === 'search') {
          const query = rest.join(' ').trim();
          if (!query) {
            console.log('Usage: /search <query>\n');
            continue;
          }
          printSearchResults(store.search(query));
          continue;
        }
        if (cmd === 'export') {
          const md = conversationToMarkdown(conversation);
          const path = rest.join(' ').trim() || defaultExportFilename(conversation);
          try {
            writeFileSync(path, md, 'utf8');
            console.log(`Exported to ${path}\n`);
          } catch (err) {
            console.log(`Could not write "${path}": ${err instanceof Error ? err.message : String(err)}\n`);
          }
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
        if (cmd === 'agent') {
          const arg = rest.join(' ').trim().toLowerCase();
          if (arg === '' || arg === 'on' || arg === 'off') agentMode = arg !== 'off';
          console.log(`Agent mode is now ${agentMode ? 'ON' : 'OFF'}.\n`);
          continue;
        }
        if (cmd === 'tools') {
          try {
            const tools = await getBridge().listTools();
            for (const t of tools) console.log(`  ${t.name}  —  ${t.description}`);
            console.log('Run one with: /run <name> <json-args>  (its output is added as context)\n');
          } catch (err) {
            console.log(`Could not list tools: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          continue;
        }
        if (cmd === 'run') {
          const [name, ...argParts] = rest;
          if (!name) {
            console.log('Usage: /run <tool-name> <json-args>\n');
            continue;
          }
          let toolArgs: Record<string, unknown> = {};
          const argStr = argParts.join(' ').trim();
          if (argStr) {
            try {
              const parsed = JSON.parse(argStr);
              if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                console.log('Tool args must be a JSON object.\n');
                continue;
              }
              toolArgs = parsed as Record<string, unknown>;
            } catch (err) {
              console.log(`Invalid JSON args: ${err instanceof Error ? err.message : String(err)}\n`);
              continue;
            }
          }
          try {
            const result = await getBridge().callTool(name, toolArgs);
            const rendered = JSON.stringify(result, null, 2);
            console.log(rendered);
            // Inject the result as context so the next question can use it.
            store.append(conversation, {
              role: 'user',
              content: `[tool ${name} output]\n\`\`\`json\n${rendered}\n\`\`\``,
            });
            store.save(conversation);
            console.log('(added to the conversation as context)\n');
          } catch (err) {
            console.log(`Tool error: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          continue;
        }
        console.log(`Unknown command: /${cmd}. Type /help.`);
        continue;
      }

      // Expand @file references into the message before sending/persisting.
      let message = applyFileContext(input, (line) => console.log(line), {
        allowAny: opts.allowAnyFile,
      });
      if (opts.redactSecrets) {
        const scrubbed = redactSecrets(message);
        if (scrubbed !== message) console.log('  (redacted secret-looking content)');
        message = scrubbed;
      }

      // Privacy guard: if the message (including any included files) looks like
      // it contains a secret, warn before it is sent and stored in plaintext.
      const kinds = detectSecrets(message);
      if (kinds.length > 0) {
        console.log(`\n⚠ This message looks like it contains ${describeSecretKinds(kinds)}.`);
        console.log('  It would be sent to the provider and saved to this conversation in plaintext.');
        if (prompt.isInteractive) {
          const proceed = await prompt.confirm('  Send and store it anyway?', false);
          if (!proceed) {
            console.log('  Skipped — nothing was sent or saved.\n');
            continue;
          }
        } else {
          console.log('  (continuing; run interactively to be prompted before sending)\n');
        }
      }

      // Agent mode: let the model call tools (non-streaming) then answer.
      if (agentMode) {
        try {
          await runAgentTurn(conversation, message);
        } catch (err) {
          if (err instanceof ProviderError) console.log(formatError(err, config.apiKeyRef?.replace(/^env:/, '')));
          else console.log(`Error: ${err instanceof Error ? err.message : String(err)}`);
          console.log('');
        }
        continue;
      }

      // Regular message — stream the assistant reply and auto-save.
      // A single Ctrl+C cancels the in-flight reply (keeping the partial answer
      // and persisting the turn) instead of killing the process.
      process.stdout.write('assistant> ');
      const controller = new AbortController();
      const unsubscribe = prompt.onSigint(() => controller.abort());
      try {
        await agent.runStream(message, (delta) => process.stdout.write(delta), controller.signal, {
          maxTokens,
        });
        process.stdout.write('\n');
        if (controller.signal.aborted) {
          console.log('[cancelled — partial reply saved]');
        }
        if (agent.lastTrimmedCount > 0) {
          console.log(`[context] trimmed ${agent.lastTrimmedCount} older message(s) to fit the context window`);
        }
        const usage = agent.lastUsage;
        if (usage) {
          turnCount += 1;
          sessionUsage = addUsage(sessionUsage, usage);
          console.log(formatUsageLine(usage, agent.lastUsageEstimated, sessionUsage, turnCount));
        }
        console.log('');
      } catch (err) {
        process.stdout.write('\n');
        if (err instanceof ProviderError) {
          const envName = config.apiKeyRef?.replace(/^env:/, '');
          console.log(formatError(err, envName));
          console.log('');
        } else {
          console.log(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      } finally {
        unsubscribe();
      }
    }

    console.log(
      ephemeral
        ? '\nGoodbye. (Ephemeral session — nothing was saved.)'
        : '\nGoodbye. Your conversation was saved automatically.',
    );
  } finally {
    prompt.close();
    bridge?.close();
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
