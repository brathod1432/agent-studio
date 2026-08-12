// Settings persistence + first-run detection. Settings are layered:
//   config/default.json  ->  saved user settings (data dir)
// Secrets are NEVER written here (only apiKeyRef, e.g. "env:NVIDIA_API_KEY").

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { JsonParseError, parseJson } from '../core/jsonFile.ts';
import { logger } from '../core/logger.ts';
import { resolvePaths } from '../core/paths.ts';
import { envRef } from '../core/secrets.ts';
import { loadCatalog, loadDefaultConfig } from './catalog.ts';
import type { AppSettings, ProviderCatalog, ProviderConfig, ProviderPreset } from './types.ts';

/**
 * Read + parse the settings file, BOM-safe. Returns undefined when the file is
 * absent. On malformed content, emits a clear warning (so the user knows their
 * file was ignored) and returns undefined instead of crashing or silently
 * reverting with no notice (see UX/security review S-4).
 */
function readSettingsFile(path: string, warn: boolean): Partial<AppSettings> | undefined {
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = parseJson(readFileSync(path, 'utf8'), path);
  } catch (err) {
    if (warn) {
      const detail = err instanceof JsonParseError ? err.message : String(err);
      logger.warn(`Ignoring unreadable settings file; using defaults instead. ${detail}`);
    }
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    if (warn) logger.warn(`Settings file "${path}" is not a JSON object; using defaults instead.`);
    return undefined;
  }
  return parsed as Partial<AppSettings>;
}

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
  // Quiet here (no warning) — loadSettings surfaces the warning once instead.
  const parsed = readSettingsFile(settingsPath(opts), false);
  if (!parsed) return true;
  return !parsed.activeProvider || !parsed.providers || Object.keys(parsed.providers).length === 0;
}

/**
 * Load effective settings. If no user settings exist, returns defaults derived
 * from config files (with the active provider materialized from the catalog).
 */
export function loadSettings(opts: StoreOptions = {}): AppSettings {
  const defaults = loadDefaultConfig(opts.configDir);
  const catalog = loadCatalog(opts.configDir);
  const path = settingsPath(opts);

  const saved: Partial<AppSettings> = readSettingsFile(path, true) ?? {};

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

/**
 * Change the model of the active provider and persist. The provider config is
 * materialized from the catalog if it wasn't saved yet. Returns the new
 * settings. Never touches secrets (only apiKeyRef is stored).
 */
export function setActiveModel(model: string, opts: StoreOptions = {}): AppSettings {
  const trimmed = model.trim();
  if (!trimmed) throw new Error('A model id is required.');
  const catalog = loadCatalog(opts.configDir);
  const settings = loadSettings(opts);
  const id = settings.activeProvider;
  if (!id) throw new Error('No active provider is configured. Run onboarding first.');

  const providers = { ...settings.providers };
  if (providers[id]) {
    providers[id] = { ...providers[id], model: trimmed };
  } else {
    const preset = catalog.providers[id];
    if (!preset) throw new Error(`Unknown provider "${id}".`);
    providers[id] = providerConfigFromPreset(preset, { model: trimmed });
  }
  const next: AppSettings = { ...settings, providers };
  saveSettings(next, opts);
  return next;
}

/**
 * Switch the active provider (materializing it from the catalog when first
 * selected) and persist. An optional model overrides the preset default.
 */
export function setActiveProvider(
  providerId: string,
  opts: StoreOptions & { model?: string } = {},
): AppSettings {
  const catalog = loadCatalog(opts.configDir);
  const settings = loadSettings(opts);
  const providers = { ...settings.providers };
  const existing = providers[providerId];
  const preset = catalog.providers[providerId];
  if (!existing && !preset) throw new Error(`Unknown provider "${providerId}".`);
  if (existing) {
    if (opts.model) providers[providerId] = { ...existing, model: opts.model };
  } else if (preset) {
    providers[providerId] = providerConfigFromPreset(preset, {
      model: opts.model ?? preset.defaultModel,
    });
  }
  const next: AppSettings = { ...settings, activeProvider: providerId, providers };
  saveSettings(next, opts);
  return next;
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
