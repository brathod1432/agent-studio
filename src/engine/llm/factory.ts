// LLM client factory. Selects the correct implementation from the configured
// provider. No provider-specific logic leaks outside the provider clients.

import { loadCatalog } from '../config/catalog.ts';
import { loadSettings, resolveActiveProvider, type StoreOptions } from '../config/store.ts';
import type { AppSettings, ProviderConfig } from '../config/types.ts';
import { registerSecretValue } from '../core/redact.ts';
import { resolveSecret } from '../core/secrets.ts';
import { ProviderError } from '../providers/errors.ts';
import type { FetchLike } from '../providers/types.ts';
import { NvidiaClient } from './providers/nvidiaClient.ts';
import { OpenAICompatibleChatClient } from './providers/openAICompatibleClient.ts';
import type { LLMClient, LLMClientOptions } from './types.ts';

/** Create an LLM client for an explicit provider config (used in tests too). */
export function createLLMClient(opts: LLMClientOptions): LLMClient {
  const { config } = opts;
  switch (config.kind) {
    case 'openai-compatible':
      return config.id === 'nvidia' ? new NvidiaClient(opts) : new OpenAICompatibleChatClient(opts);
    case 'anthropic':
      throw new ProviderError({
        kind: 'invalid_config',
        message: 'The Anthropic chat client is not implemented yet.',
        retryable: false,
      });
    default:
      throw new ProviderError({
        kind: 'invalid_config',
        message: `Unknown provider kind: ${String((config as ProviderConfig).kind)}`,
        retryable: false,
      });
  }
}

export interface FromSettingsOptions {
  store?: StoreOptions;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
}

export interface ResolvedLLM {
  client: LLMClient;
  config: ProviderConfig;
  settings: AppSettings;
}

/**
 * Build an LLM client from the currently persisted settings + active provider,
 * reusing settings storage and API-key lookup. Throws a normalized
 * ProviderError when no provider is configured.
 */
export function createLLMClientFromSettings(opts: FromSettingsOptions = {}): ResolvedLLM {
  const env = opts.env ?? process.env;
  const settings = loadSettings(opts.store);
  const catalog = loadCatalog(opts.store?.configDir);
  const config = resolveActiveProvider(settings, catalog);
  if (!config) {
    throw new ProviderError({
      kind: 'invalid_config',
      message: 'No provider is configured. Run onboarding first.',
      retryable: false,
    });
  }
  const resolved = resolveSecret(config.apiKeyRef, env);
  if (resolved.present && resolved.secret) registerSecretValue(resolved.secret.reveal());
  const client = createLLMClient({
    config,
    apiKey: resolved.secret?.reveal(),
    request: settings.request,
    fetchImpl: opts.fetchImpl,
  });
  return { client, config, settings };
}
