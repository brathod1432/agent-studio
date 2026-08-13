// Configuration types. The default provider/model are data (loaded from config
// files and user settings), never hardcoded constants in application logic.

export type ProviderKind = 'openai-compatible' | 'anthropic';

/** A built-in provider preset (from config/providers.json). */
export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Name of the env var that holds this provider's API key (may be empty). */
  apiKeyEnv: string;
  requiresApiKey: boolean;
  defaultModel: string;
  docsUrl?: string;
  notes?: string;
}

export interface ProviderCatalog {
  providers: Record<string, ProviderPreset>;
}

export interface RequestSettings {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

/**
 * A user-configured provider. Note: it holds only `apiKeyRef` (e.g.
 * "env:NVIDIA_API_KEY") — NEVER the API key value itself.
 */
export interface ProviderConfig {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKeyRef?: string;
  model: string;
}

export interface AppSettings {
  activeProvider?: string;
  defaultModel: string;
  providers: Record<string, ProviderConfig>;
  request: RequestSettings;
  /** Max estimated tokens of history to send per turn (0 = unlimited). */
  maxContextTokens: number;
  /** Default cap on generated tokens per reply (0 = unset/provider default). */
  maxOutputTokens: number;
}

/** Shape of config/default.json. */
export interface DefaultConfig {
  activeProvider?: string;
  defaultModel: string;
  request: RequestSettings;
  /** Max estimated tokens of history to send per turn (0 = unlimited). */
  maxContextTokens: number;
  /** Default cap on generated tokens per reply (0 = unset/provider default). */
  maxOutputTokens: number;
}
