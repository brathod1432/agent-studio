// LLM client abstraction. Provider-agnostic: the agent/runtime only knows these
// types, never a specific vendor. Concrete adapters live in ./providers.

import type { ProviderConfig, RequestSettings } from '../config/types.ts';
import type { FetchLike } from '../providers/types.ts';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Optional model override; defaults to the configured provider model. */
  model?: string;
  temperature?: number;
  /** Cap on generated tokens (max_tokens). Omitted = provider default. */
  maxTokens?: number;
  /**
   * Optional caller-controlled cancellation. When aborted, streaming stops and
   * the partial reply so far is returned (finishReason "cancelled") rather than
   * throwing — so the turn can still be persisted.
   */
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** A tool/function call requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // raw JSON string as returned by the provider
}

/** OpenAI-style function-tool schema advertised to the model. */
export interface ToolSchema {
  type: 'function';
  function: { name: string; description?: string; parameters?: unknown };
}

/** A raw OpenAI-shaped message (so assistant tool_calls + tool results thread). */
export type RawMessage = Record<string, unknown>;

export interface ToolChatRequest {
  messages: RawMessage[];
  tools: ToolSchema[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  model?: string;
  finishReason?: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
}

/** Called with each incremental text delta during streaming. */
export type StreamDeltaHandler = (delta: string) => void;

export interface LLMClient {
  readonly providerId: string;
  readonly model: string;
  /** Single request/response chat completion. */
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Streaming chat completion. Falls back to `chat` when unsupported. */
  chatStream(request: ChatRequest, onDelta: StreamDeltaHandler): Promise<ChatResponse>;
  /** Non-streaming completion advertising tools; returns any tool_calls. */
  chatWithTools(request: ToolChatRequest): Promise<ChatResponse>;
  /** Whether this client/model streams incrementally. */
  supportsStreaming(): boolean;
  /** Lightweight reachability + auth check. */
  validate(): Promise<boolean>;
}

/** Everything an adapter needs. `apiKey` is the resolved secret value — never logged. */
export interface LLMClientOptions {
  config: ProviderConfig;
  apiKey?: string;
  request: RequestSettings;
  fetchImpl?: FetchLike;
}
