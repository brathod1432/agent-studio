// ChatAgent — the first end-to-end conversational runtime.
//
// Flow per turn:
//   user input -> load memory -> append user message -> call LLM
//     -> append assistant message -> persist memory -> return response
//
// Auto-save: every assistant reply is persisted automatically; there is no
// manual save step. Streaming and non-streaming paths both persist identically.

import { trimMessages } from '../llm/contextWindow.ts';
import type { ChatMessage, ChatResponse, LLMClient, TokenUsage } from '../llm/types.ts';
import { estimateTokensFromText, estimateUsage, hasTokenCounts } from '../llm/usage.ts';
import type { ConversationStore } from '../memory/store.ts';
import type { Conversation } from '../memory/types.ts';
import { CHAT_SYSTEM, defaultRegistry, type PromptRegistry } from '../prompts/registry.ts';
import type { Agent, AgentDeltaHandler, StreamingAgent } from './agent.ts';

export interface ChatAgentOptions {
  llm: LLMClient;
  store: ConversationStore;
  conversation: Conversation;
  /** Prompt registry (defaults to the shared default registry). */
  prompts?: PromptRegistry;
  /** Override the system prompt text directly (skips the registry). */
  systemPrompt?: string;
  /**
   * Max estimated tokens of history to send per turn (0/undefined = unlimited).
   * Older messages are trimmed from the request only; stored history is intact.
   */
  maxContextTokens?: number;
}

/** Per-turn overrides (e.g. a one-shot cheaper model or deterministic temperature). */
export interface TurnOptions {
  model?: string;
  temperature?: number;
}

export class ChatAgent implements Agent, StreamingAgent {
  #llm: LLMClient;
  #store: ConversationStore;
  #conversation: Conversation;
  #systemPrompt: string;
  #maxContextTokens: number;
  #lastUsage?: TokenUsage;
  #lastUsageEstimated = false;
  #lastTrimmed = 0;

  constructor(opts: ChatAgentOptions) {
    this.#llm = opts.llm;
    this.#store = opts.store;
    this.#conversation = opts.conversation;
    this.#maxContextTokens = opts.maxContextTokens ?? 0;
    this.#systemPrompt =
      opts.systemPrompt ??
      (opts.prompts ?? defaultRegistry()).get(CHAT_SYSTEM).render({ model: opts.llm.model });
  }

  get conversation(): Conversation {
    return this.#conversation;
  }

  /** Token usage for the most recent turn (exact or estimated). */
  get lastUsage(): TokenUsage | undefined {
    return this.#lastUsage;
  }

  /** True when {@link lastUsage} is a local estimate (provider gave no counts). */
  get lastUsageEstimated(): boolean {
    return this.#lastUsageEstimated;
  }

  /** Number of oldest messages trimmed from the last request to fit the context window. */
  get lastTrimmedCount(): number {
    return this.#lastTrimmed;
  }

  /**
   * Build the request messages: system prompt + conversation history, trimming
   * the oldest history to fit `maxContextTokens` (the system prompt is always
   * kept). Trimming only affects the request; stored history is unchanged.
   */
  #buildMessages(): ChatMessage[] {
    const system: ChatMessage = { role: 'system', content: this.#systemPrompt };
    if (this.#maxContextTokens <= 0) {
      this.#lastTrimmed = 0;
      return [system, ...this.#conversation.messages];
    }
    // Reserve room for the system prompt. A computed budget of <= 0 means the
    // system prompt alone fills the window, so keep only the latest message
    // (budget 1 → trimMessages keeps just the last). This differs from the
    // "unlimited" case above (maxContextTokens <= 0).
    const budget = Math.max(1, this.#maxContextTokens - estimateTokensFromText(this.#systemPrompt));
    const { messages, dropped } = trimMessages(this.#conversation.messages, budget);
    this.#lastTrimmed = dropped;
    return [system, ...messages];
  }

  /** Record usage from a response, falling back to a local estimate. */
  #recordUsage(messages: ChatMessage[], response: ChatResponse): void {
    if (hasTokenCounts(response.usage)) {
      this.#lastUsage = response.usage;
      this.#lastUsageEstimated = false;
    } else {
      this.#lastUsage = estimateUsage(messages, response.content);
      this.#lastUsageEstimated = true;
    }
  }

  async run(input: string, opts: TurnOptions = {}): Promise<string> {
    this.#store.append(this.#conversation, { role: 'user', content: input });
    const messages = this.#buildMessages();
    const response = await this.#llm.chat({ messages, model: opts.model, temperature: opts.temperature });
    this.#store.append(this.#conversation, { role: 'assistant', content: response.content });
    this.#store.save(this.#conversation); // auto-save
    this.#recordUsage(messages, response);
    return response.content;
  }

  async runStream(
    input: string,
    onDelta: AgentDeltaHandler,
    signal?: AbortSignal,
    opts: TurnOptions = {},
  ): Promise<string> {
    this.#store.append(this.#conversation, { role: 'user', content: input });
    const messages = this.#buildMessages();
    const req = { messages, signal, model: opts.model, temperature: opts.temperature };
    let response;
    if (this.#llm.supportsStreaming()) {
      response = await this.#llm.chatStream(req, onDelta);
    } else {
      // Fallback: no streaming — emit the full response as a single delta.
      response = await this.#llm.chat(req);
      if (response.content) onDelta(response.content);
    }
    // Persist the turn even when cancelled: the user's question and any partial
    // reply are kept. An empty (fully-cancelled) reply is not appended, but the
    // user message is still saved so the turn is never silently lost.
    if (response.content) {
      this.#store.append(this.#conversation, { role: 'assistant', content: response.content });
    }
    this.#store.save(this.#conversation); // auto-save, unaffected by streaming/cancel
    this.#recordUsage(messages, response);
    return response.content;
  }
}
