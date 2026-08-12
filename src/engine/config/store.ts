// Settings persistence + first-run detection. Settings are layered:
//   config/default.json  ->  saved user settings (data dir)
// Secrets are NEVER written here (only apiKeyRef, e.g. "env:NVIDIA_API_KEY").

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { resolvePaths } from '../core/paths.ts';
import { envRef } from '../core/secrets.ts';
import { loadCatalog, loadDefaultConfig } from './catalog.ts';
import type { AppSettings, ProviderCatalog, ProviderConfig, ProviderPreset } from './types.ts';

export interface StoreOptions {
  configDir?: string;
  dataDir?: string;
  settingsFile?: string;
}

function settingsPath(opts: StoreOptions): string {
  if (opts.settingsFile) return opts.settingsFile;
  const base = resolvePaths();
  return opts.dataDir ? `${opts.dataDir}/settings.json` : base.settingsFile;
}

/** Build a ProviderConfig from a preset (used when a user selects a provider). */
export function providerConfigFromPreset(
  preset: ProviderPreset,
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    id: preset.id,
    label: preset.label,
    kind: preset.kind,
    baseUrl: overrides.baseUrl ?? preset.baseUrl,
    apiKeyRef: overrides.apiKeyRef ?? (preset.apiKeyEnv ? envRef(preset.apiKeyEnv) : undefined),
    model: overrides.model ?? preset.defaultModel,
  };
}

/** True when no settings have been persisted yet (trigger onboarding). */
export function isFirstRun(opts: StoreOptions = {}): boolean {
  const path = settingsPath(opts);
  if (!existsSync(path)) return true;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppSettings>;
    return !parsed.activeProvider || !parsed.providers || Object.keys(parsed.providers).length === 0;
  } catch {
    return true;
  }
}

/**
 * Load effective settings. If no user settings exist, returns defaults derived
 * from config files (with the active provider materialized from the catalog).
 */
export function loadSettings(opts: StoreOptions = {}): AppSettings {
  const defaults = loadDefaultConfig(opts.configDir);
  const catalog = loadCatalog(opts.configDir);
  const path = settingsPath(opts);

  let saved: Partial<AppSettings> = {};
  if (existsSync(path)) {
    try {
      saved = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppSettings>;
    } catch {
      saved = {};
    }
  }

  const activeProvider = saved.activeProvider ?? defaults.activeProvider;
  const providers: Record<string, ProviderConfig> = { ...(saved.providers ?? {}) };

  // Materialize the default active provider from the catalog if not yet configured.
  if (activeProvider && !providers[activeProvider] && catalog.providers[activeProvider]) {
    providers[activeProvider] = providerConfigFromPreset(catalog.providers[activeProvider], {
      model: defaults.defaultModel || catalog.providers[activeProvider].defaultModel,
    });
  }

  return {
    activeProvider,
    defaultModel: saved.defaultModel ?? defaults.defaultModel,
    providers,
    request: { ...defaults.request, ...(saved.request ?? {}) },
  };
}

/** Strip any accidental secret-bearing fields before persisting. */
function sanitizeForPersistence(settings: AppSettings): AppSettings {
  const providers: Record<string, ProviderConfig> = {};
  for (const [id, p] of Object.entries(settings.providers)) {
    const clone = { ...p } as ProviderConfig & { apiKey?: unknown; key?: unknown; secret?: unknown };
    // Defense-in-depth: never persist a raw key even if one leaked into the object.
    delete clone.apiKey;
    delete clone.key;
    delete clone.secret;
    providers[id] = {
      id: clone.id,
      label: clone.label,
      kind: clone.kind,
      baseUrl: clone.baseUrl,
      apiKeyRef: clone.apiKeyRef,
      model: clone.model,
    };
  }
  return { ...settings, providers };
}

export function saveSettings(settings: AppSettings, opts: StoreOptions = {}): string {
  const path = settingsPath(opts);
  mkdirSync(dirname(path), { recursive: true });
  const safe = sanitizeForPersistence(settings);
  writeFileSync(path, JSON.stringify(safe, null, 2) + '\n', 'utf8');
  return path;
}

/** Resolve the active provider config, falling back to the catalog default. */
export function resolveActiveProvider(
  settings: AppSettings,
  catalog: ProviderCatalog,
): ProviderConfig | undefined {
  const id = settings.activeProvider;
  if (!id) return undefined;
  if (settings.providers[id]) return settings.providers[id];
  const preset = catalog.providers[id];
  if (!preset) return undefined;
  return providerConfigFromPreset(preset, { model: settings.defaultModel || preset.defaultModel });
}
