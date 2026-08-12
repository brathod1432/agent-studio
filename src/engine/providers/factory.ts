// Builds a Provider from a ProviderConfig based on its kind.

import type { ProviderConfig } from '../config/types.ts';
import { ProviderError } from './errors.ts';
import { OpenAICompatibleProvider } from './openaiCompatible.ts';
import type {
  ConnectionTestResult,
  ModelInfo,
  Provider,
  ProviderRuntimeContext,
} from './types.ts';

/** Placeholder adapter: Anthropic is configured for onboarding but not wired for calls in this slice. */
class AnthropicProviderStub implements Provider {
  readonly config: ProviderConfig;
  constructor(config: ProviderConfig) {
    this.config = config;
  }
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async testConnection(_ctx: ProviderRuntimeContext): Promise<ConnectionTestResult> {
    void _ctx;
    return {
      ok: false,
      status: 'warn',
      checks: [
        {
          name: 'adapter',
          status: 'warn',
          message: 'The Anthropic adapter is not implemented in this slice. Configuration is saved, but live testing is unavailable.',
        },
      ],
      error: new ProviderError({
        kind: 'invalid_config',
        message: 'Anthropic adapter not implemented yet.',
        retryable: false,
      }),
    };
  }
}

export function createProvider(config: ProviderConfig): Provider {
  switch (config.kind) {
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
    case 'anthropic':
      return new AnthropicProviderStub(config);
    default:
      throw new ProviderError({
        kind: 'invalid_config',
        message: `Unknown provider kind: ${String((config as ProviderConfig).kind)}`,
        retryable: false,
      });
  }
}
