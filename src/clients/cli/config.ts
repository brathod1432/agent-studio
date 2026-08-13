// `config` CLI command + shared provider/model selection helpers.
//
// Lets a user view and change the active provider/model without hand-editing
// JSON. Model lists are fetched live from the provider's /models endpoint
// (reusing the engine's listProviderModels), so selection is a pick-list.
// The same helpers back the in-chat /model and /provider commands.

import {
  formatError,
  listPresets,
  listProviderModels,
  loadCatalog,
  loadSettings,
  ProviderError,
  resolveActiveProvider,
  saveSettings,
  setActiveModel,
  setActiveProvider,
  type AppSettings,
  type ModelInfo,
  type ProviderConfig,
  type ProviderCatalog,
} from '../../engine/index.ts';
import { createPrompter, type Prompter } from './prompt.ts';

/** Integer tunables settable via `config get/set` (camelCase as on disk). */
export const TUNABLE_KEYS = [
  'maxOutputTokens',
  'maxContextTokens',
  'request.timeoutMs',
  'request.maxRetries',
  'request.retryBaseDelayMs',
] as const;
export type TunableKey = (typeof TUNABLE_KEYS)[number];

export function isTunableKey(key: string): key is TunableKey {
  return (TUNABLE_KEYS as readonly string[]).includes(key);
}

export function readTunable(settings: AppSettings, key: TunableKey): number {
  switch (key) {
    case 'maxOutputTokens':
      return settings.maxOutputTokens;
    case 'maxContextTokens':
      return settings.maxContextTokens;
    case 'request.timeoutMs':
      return settings.request.timeoutMs;
    case 'request.maxRetries':
      return settings.request.maxRetries;
    case 'request.retryBaseDelayMs':
      return settings.request.retryBaseDelayMs;
  }
}

export function applyTunable(settings: AppSettings, key: TunableKey, value: number): void {
  switch (key) {
    case 'maxOutputTokens':
      settings.maxOutputTokens = value;
      break;
    case 'maxContextTokens':
      settings.maxContextTokens = value;
      break;
    case 'request.timeoutMs':
      settings.request.timeoutMs = value;
      break;
    case 'request.maxRetries':
      settings.request.maxRetries = value;
      break;
    case 'request.retryBaseDelayMs':
      settings.request.retryBaseDelayMs = value;
      break;
  }
}

/** Map a user's answer (1-based index or exact id) to an id from the list. */
export function resolveChoice(answer: string, ids: string[]): string | undefined {
  const a = answer.trim();
  if (!a) return undefined;
  const n = Number(a);
  if (Number.isInteger(n) && n >= 1 && n <= ids.length) return ids[n - 1];
  return ids.includes(a) ? a : undefined;
}

/** Print the current configuration (secret-safe) plus available providers. */
export function showConfig(): void {
  const catalog = loadCatalog();
  const settings = loadSettings();
  const active = resolveActiveProvider(settings, catalog);
  console.log('Current configuration:');
  console.log(`  Active provider:  ${active ? `${active.label} (${active.id})` : '(none)'}`);
  if (active) {
    console.log(`  Endpoint:         ${active.baseUrl || '(not set)'}`);
    console.log(`  Model:            ${active.model || '(not set)'}`);
    console.log(`  API key ref:      ${active.apiKeyRef ?? '(none)'}`);
  }
  console.log('\nAvailable providers:');
  for (const p of listPresets(catalog)) {
    const marker = active && p.id === active.id ? '*' : ' ';
    console.log(`  ${marker} ${p.id}  —  ${p.label}`);
  }
  console.log('\nChange with:  config model <id> | config provider <id>');
  console.log('(run "config model" with no id to pick from the live model list)');
}

/**
 * Interactively choose a model id for a provider by fetching the live list.
 * Returns the chosen id, or undefined if cancelled / unavailable.
 */
export async function chooseModelId(
  prompt: Prompter,
  config: ProviderConfig,
): Promise<string | undefined> {
  const request = loadSettings().request;
  let models: ModelInfo[];
  try {
    console.log('Fetching available models…');
    models = await listProviderModels(config, { request });
  } catch (err) {
    if (err instanceof ProviderError) {
      console.log(formatError(err, config.apiKeyRef?.replace(/^env:/, '')));
    } else {
      console.log(`Could not list models: ${err instanceof Error ? err.message : String(err)}`);
    }
    const manual = (await prompt.ask('Enter a model id manually (or Enter to cancel)')).trim();
    return manual || undefined;
  }
  if (models.length === 0) {
    const manual = (await prompt.ask('The endpoint returned no models. Enter a model id manually')).trim();
    return manual || undefined;
  }
  const ids = models.map((m) => m.id);
  console.log(`\n${ids.length} model(s) available:`);
  ids.forEach((id, i) => {
    const current = id === config.model ? '  (current)' : '';
    console.log(`  ${i + 1}. ${id}${current}`);
  });
  const ans = await prompt.ask('\nSelect a model (number or id, Enter to cancel)');
  if (!ans.trim()) return undefined;
  const picked = resolveChoice(ans, ids);
  if (!picked) {
    // Allow a free-typed id that isn't in the list (self-hosted / new models).
    return ans.trim();
  }
  return picked;
}

/** Interactively choose a provider id from the catalog. */
export async function chooseProviderId(
  prompt: Prompter,
  catalog: ProviderCatalog,
  currentId?: string,
): Promise<string | undefined> {
  const presets = listPresets(catalog);
  const ids = presets.map((p) => p.id);
  console.log('\nProviders:');
  presets.forEach((p, i) => {
    const current = p.id === currentId ? '  (current)' : '';
    console.log(`  ${i + 1}. ${p.label} (${p.id})${current}${p.notes ? ` — ${p.notes}` : ''}`);
  });
  const ans = await prompt.ask('\nSelect a provider (number or id, Enter to cancel)');
  if (!ans.trim()) return undefined;
  return resolveChoice(ans, ids);
}

/** Entry point for `agent-studio config [model|provider] [id]`. */
export async function runConfig(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  if (!sub || sub === 'show') {
    showConfig();
    return;
  }

  if (sub === 'model') {
    const catalog = loadCatalog();
    const active = resolveActiveProvider(loadSettings(), catalog);
    if (!active) {
      console.log('No provider is configured. Run "onboard" first.');
      process.exitCode = 1;
      return;
    }
    let model = rest.join(' ').trim();
    if (!model) {
      if (!process.stdin.isTTY) {
        console.log('Usage: config model <id>  (or run in an interactive terminal to pick from a list)');
        process.exitCode = 2;
        return;
      }
      const prompt = createPrompter();
      try {
        model = (await chooseModelId(prompt, active)) ?? '';
      } finally {
        prompt.close();
      }
      if (!model) {
        console.log('No change made.');
        return;
      }
    }
    setActiveModel(model);
    console.log(`Active model is now "${model}" for provider "${active.label}".`);
    return;
  }

  if (sub === 'provider') {
    const catalog = loadCatalog();
    const active = resolveActiveProvider(loadSettings(), catalog);
    let providerId = rest.join(' ').trim();
    if (!providerId) {
      if (!process.stdin.isTTY) {
        console.log('Usage: config provider <id>  (or run in an interactive terminal to pick from a list)');
        process.exitCode = 2;
        return;
      }
      const prompt = createPrompter();
      try {
        providerId = (await chooseProviderId(prompt, catalog, active?.id)) ?? '';
      } finally {
        prompt.close();
      }
      if (!providerId) {
        console.log('No change made.');
        return;
      }
    }
    try {
      const next = setActiveProvider(providerId);
      const now = resolveActiveProvider(next, catalog);
      console.log(`Active provider is now "${now?.label ?? providerId}" (model: ${now?.model || '(not set)'}).`);
      if (now && !now.model) {
        console.log('No model set for this provider yet — use "config model <id>" to choose one.');
      }
    } catch (err) {
      console.log(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
    return;
  }

  if (sub === 'get') {
    const settings = loadSettings();
    const key = rest[0];
    if (!key) {
      for (const k of TUNABLE_KEYS) console.log(`  ${k} = ${readTunable(settings, k)}`);
      return;
    }
    if (!isTunableKey(key)) {
      console.log(`Unknown key "${key}". Known: ${TUNABLE_KEYS.join(', ')}`);
      process.exitCode = 2;
      return;
    }
    console.log(String(readTunable(settings, key)));
    return;
  }

  if (sub === 'set') {
    const key = rest[0];
    const raw = rest[1];
    if (!key || raw == null) {
      console.log(`Usage: config set <key> <int>. Keys: ${TUNABLE_KEYS.join(', ')}`);
      process.exitCode = 2;
      return;
    }
    if (!isTunableKey(key)) {
      console.log(`Unknown key "${key}". Known: ${TUNABLE_KEYS.join(', ')}`);
      process.exitCode = 2;
      return;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      console.log(`"${raw}" is not a non-negative integer.`);
      process.exitCode = 2;
      return;
    }
    const settings = loadSettings();
    applyTunable(settings, key, value);
    saveSettings(settings);
    console.log(`${key} = ${value}`);
    return;
  }

  console.log('Usage: config [show | model [<id>] | provider [<id>] | get [key] | set <key> <int>]');
  process.exitCode = 2;
}
