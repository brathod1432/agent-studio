// Provider abstraction. The engine only knows this interface; concrete adapters
// (OpenAI-compatible, Anthropic, ...) implement it. This keeps Agent Studio
// provider-agnostic (see docs/provider-architecture.md).

import type { ProviderConfig, RequestSettings } from '../config/types.ts';
import type { ProviderError } from './errors.ts';

/** Injectable fetch signature (matches global fetch) so tests can mock it. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ModelInfo {
  id: string;
  ownedBy?: string;
}

export interface ProviderRuntimeContext {
  /** Resolved API key value (only present when configured). Never logged. */
  apiKey?: string;
  request: RequestSettings;
  fetchImpl?: FetchLike;
  /** Override the wall clock for timeouts (testing). */
  now?: () => number;
}

export type CheckStatus = 'ok' | 'warn' | 'error';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  /** Optional structured detail, must be safe to log. */
  detail?: Record<string, unknown>;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: CheckStatus;
  checks: CheckResult[];
  /** Models discovered during the test, if the endpoint supports listing. */
  models?: ModelInfo[];
  /** Normalized error when the test failed at the transport/auth level. */
  error?: ProviderError;
  /** Milliseconds the primary reachability call took. */
  latencyMs?: number;
}

export interface Provider {
  readonly config: ProviderConfig;
  /** Lightweight reachability + auth check (e.g. GET /models). */
  testConnection(ctx: ProviderRuntimeContext): Promise<ConnectionTestResult>;
  /** List available models (may return empty if unsupported). */
  listModels(ctx: ProviderRuntimeContext): Promise<ModelInfo[]>;
}
