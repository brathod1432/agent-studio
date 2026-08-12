import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadCatalog, loadDefaultConfig } from './catalog.ts';
import {
  isFirstRun,
  loadSettings,
  providerConfigFromPreset,
  resolveActiveProvider,
  saveSettings,
} from './store.ts';
import type { AppSettings } from './types.ts';

const NVIDIA_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

test('NVIDIA provider initialization: preset loads from config catalog', () => {
  const catalog = loadCatalog();
  const nvidia = catalog.providers.nvidia;
  assert.ok(nvidia, 'nvidia preset must exist');
  assert.equal(nvidia.kind, 'openai-compatible');
  assert.equal(nvidia.baseUrl, 'https://integrate.api.nvidia.com/v1');
  assert.equal(nvidia.apiKeyEnv, 'NVIDIA_API_KEY');
  assert.equal(nvidia.requiresApiKey, true);
  assert.equal(nvidia.defaultModel, NVIDIA_MODEL);
});

test('model configuration loading: default model comes from config, not hardcoded', () => {
  const defaults = loadDefaultConfig();
  assert.equal(defaults.defaultModel, NVIDIA_MODEL);
  assert.equal(defaults.activeProvider, 'nvidia');
  // The catalog default and the app default agree, proving config-driven wiring.
  assert.equal(loadCatalog().providers.nvidia.defaultModel, defaults.defaultModel);
});

test('providerConfigFromPreset stores an apiKeyRef, never a key value', () => {
  const nvidia = loadCatalog().providers.nvidia;
  const cfg = providerConfigFromPreset(nvidia);
  assert.equal(cfg.apiKeyRef, 'env:NVIDIA_API_KEY');
  assert.equal(cfg.model, NVIDIA_MODEL);
  assert.ok(!('apiKey' in cfg));
});

test('settings persistence: round-trips and never writes secrets', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-store-'));
  try {
    assert.equal(isFirstRun({ dataDir }), true);

    const base = loadSettings({ dataDir });
    // Simulate a leaked raw key on the object to prove sanitization strips it.
    const providers = { ...base.providers };
    providers.nvidia = {
      ...(providers.nvidia ?? providerConfigFromPreset(loadCatalog().providers.nvidia)),
    };
    (providers.nvidia as Record<string, unknown>).apiKey = 'nvapi-LEAKED-should-not-persist';
    const toSave: AppSettings = { ...base, activeProvider: 'nvidia', providers };

    const path = saveSettings(toSave, { dataDir });
    const raw = readFileSync(path, 'utf8');
    assert.ok(!raw.includes('nvapi-LEAKED-should-not-persist'), 'raw key must never be persisted');
    assert.ok(raw.includes('env:NVIDIA_API_KEY'), 'only the apiKeyRef is persisted');

    assert.equal(isFirstRun({ dataDir }), false);
    const reloaded = loadSettings({ dataDir });
    assert.equal(reloaded.activeProvider, 'nvidia');
    assert.equal(reloaded.providers.nvidia?.apiKeyRef, 'env:NVIDIA_API_KEY');
    assert.equal((reloaded.providers.nvidia as Record<string, unknown>).apiKey, undefined);

    const active = resolveActiveProvider(reloaded, loadCatalog());
    assert.equal(active?.id, 'nvidia');
    assert.equal(active?.model, NVIDIA_MODEL);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
