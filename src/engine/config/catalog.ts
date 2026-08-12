// Loads the provider catalog and default config from JSON files at runtime, so
// users can edit provider presets / defaults without any code changes.

import { join } from 'node:path';

import { readJsonFile } from '../core/jsonFile.ts';
import { resolvePaths } from '../core/paths.ts';
import type { DefaultConfig, ProviderCatalog, ProviderKind, ProviderPreset } from './types.ts';

const VALID_KINDS: readonly ProviderKind[] = ['openai-compatible', 'anthropic'];

function coercePreset(id: string, raw: Record<string, unknown>): ProviderPreset {
  const kind = raw.kind as ProviderKind;
  if (!VALID_KINDS.includes(kind)) {
    throw new Error(`Provider "${id}" has invalid kind "${String(raw.kind)}"`);
  }
  return {
    id: String(raw.id ?? id),
    label: String(raw.label ?? id),
    kind,
    baseUrl: String(raw.baseUrl ?? ''),
    apiKeyEnv: String(raw.apiKeyEnv ?? ''),
    requiresApiKey: Boolean(raw.requiresApiKey),
    defaultModel: String(raw.defaultModel ?? ''),
    docsUrl: raw.docsUrl ? String(raw.docsUrl) : undefined,
    notes: raw.notes ? String(raw.notes) : undefined,
  };
}

export function loadCatalog(configDir?: string): ProviderCatalog {
  const dir = configDir ?? resolvePaths().configDir;
  const raw = readJsonFile(join(dir, 'providers.json')) as { providers?: Record<string, Record<string, unknown>> };
  const providers: Record<string, ProviderPreset> = {};
  for (const [id, preset] of Object.entries(raw.providers ?? {})) {
    providers[id] = coercePreset(id, preset);
  }
  if (Object.keys(providers).length === 0) {
    throw new Error(`No providers found in ${join(dir, 'providers.json')}`);
  }
  return { providers };
}

export function loadDefaultConfig(configDir?: string): DefaultConfig {
  const dir = configDir ?? resolvePaths().configDir;
  const raw = readJsonFile(join(dir, 'default.json')) as Record<string, unknown>;
  const request = (raw.request ?? {}) as Record<string, unknown>;
  return {
    activeProvider: raw.activeProvider ? String(raw.activeProvider) : undefined,
    defaultModel: String(raw.defaultModel ?? ''),
    request: {
      timeoutMs: Number(request.timeoutMs ?? 30000),
      maxRetries: Number(request.maxRetries ?? 2),
      retryBaseDelayMs: Number(request.retryBaseDelayMs ?? 500),
    },
    maxContextTokens: Number(raw.maxContextTokens ?? 0),
  };
}

/** List presets as an array for UI/onboarding (stable order). */
export function listPresets(catalog: ProviderCatalog): ProviderPreset[] {
  return Object.values(catalog.providers);
}
