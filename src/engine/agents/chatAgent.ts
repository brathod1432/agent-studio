// ChatAgent — the first end-to-end conversational runtime.
//
// Flow per turn:
//   user input -> load memory -> append user message -> call LLM
//     -> append assistant message -> persist memory -> return response
//
// Auto-save: every assistant reply is persisted automatically; there is no
// manual save step. Streaming and non-streaming paths both persist identically.

import type { ChatMessage, ChatResponse, LLMClient, TokenUsage } from '../llm/types.ts';
import { estimateUsage, hasTokenCounts } from '../llm/usage.ts';
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
}

export class ChatAgent implements Agent, StreamingAgent {
  #llm: LLMClient;
  #store: ConversationStore;
  #conversation: Conversation;
  #systemPrompt: string;
  #lastUsage?: TokenUsage;
  #lastUsageEstimated = false;

  constructor(opts: ChatAgentOptions) {
    this.#llm = opts.llm;
    this.#store = opts.store;
    this.#conversation = opts.conversation;
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

  /** Build the request messages: system prompt + full conversation history. */
  #buildMessages(): ChatMessage[] {
    return [{ role: 'system', content: this.#systemPrompt }, ...this.#conversation.messages];
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

  async run(input: string): Promise<string> {
    this.#store.append(this.#conversation, { role: 'user', content: input });
    const messages = this.#buildMessages();
    const response = await this.#llm.chat({ messages });
    this.#store.append(this.#conversation, { role: 'assistant', content: response.content });
    this.#store.save(this.#conversation); // auto-save
    this.#recordUsage(messages, response);
    return response.content;
  }

  async runStream(input: string, onDelta: AgentDeltaHandler, signal?: AbortSignal): Promise<string> {
    this.#store.append(this.#conversation, { role: 'user', content: input });
    const messages = this.#buildMessages();
    let response;
    if (this.#llm.supportsStreaming()) {
      response = await this.#llm.chatStream({ messages, signal }, onDelta);
    } else {
      // Fallback: no streaming — emit the full response as a single delta.
      response = await this.#llm.chat({ messages, signal });
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
