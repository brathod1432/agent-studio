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

export interface ChatResponse {
  content: string;
  model?: string;
  finishReason?: string;
  usage?: TokenUsage;
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
