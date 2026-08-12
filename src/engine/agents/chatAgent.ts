// ChatAgent — the first end-to-end conversational runtime.
//
// Flow per turn:
//   user input -> load memory -> append user message -> call LLM
//     -> append assistant message -> persist memory -> return response
//
// Auto-save: every assistant reply is persisted automatically; there is no
// manual save step. Streaming and non-streaming paths both persist identically.

import type { ChatMessage, LLMClient } from '../llm/types.ts';
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

  /** Build the request messages: system prompt + full conversation history. */
  #buildMessages(): ChatMessage[] {
    return [{ role: 'system', content: this.#systemPrompt }, ...this.#conversation.messages];
  }

  async run(input: string): Promise<string> {
    this.#store.append(this.#conversation, { role: 'user', content: input });
    const response = await this.#llm.chat({ messages: this.#buildMessages() });
    this.#store.append(this.#conversation, { role: 'assistant', content: response.content });
    this.#store.save(this.#conversation); // auto-save
    return response.content;
  }

  async runStream(input: string, onDelta: AgentDeltaHandler): Promise<string> {
    this.#store.append(this.#conversation, { role: 'user', content: input });
    let response;
    if (this.#llm.supportsStreaming()) {
      response = await this.#llm.chatStream({ messages: this.#buildMessages() }, onDelta);
    } else {
      // Fallback: no streaming — emit the full response as a single delta.
      response = await this.#llm.chat({ messages: this.#buildMessages() });
      if (response.content) onDelta(response.content);
    }
    this.#store.append(this.#conversation, { role: 'assistant', content: response.content });
    this.#store.save(this.#conversation); // auto-save, unaffected by streaming
    return response.content;
  }
}
