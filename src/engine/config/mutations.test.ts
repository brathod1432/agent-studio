import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadCatalog } from './catalog.ts';
import { loadSettings, resolveActiveProvider, setActiveModel, setActiveProvider } from './store.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'as-mut-'));
}

test('setActiveModel: changes the active provider model and persists it', () => {
  const dataDir = tmp();
  try {
    const next = setActiveModel('nvidia/some-other-model', { dataDir });
    assert.equal(next.activeProvider, 'nvidia');
    assert.equal(next.providers.nvidia?.model, 'nvidia/some-other-model');

    // Reloads from disk with the new model resolved as active.
    const reloaded = loadSettings({ dataDir });
    const active = resolveActiveProvider(reloaded, loadCatalog());
    assert.equal(active?.model, 'nvidia/some-other-model');

    // Secret-safe: only the apiKeyRef is written, never a key value.
    const raw = readFileSync(join(dataDir, 'settings.json'), 'utf8');
    assert.ok(raw.includes('env:NVIDIA_API_KEY'));
    assert.ok(!/nvapi-/.test(raw));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('setActiveModel: rejects an empty model id', () => {
  const dataDir = tmp();
  try {
    assert.throws(() => setActiveModel('   ', { dataDir }), /model id is required/i);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('setActiveProvider: switches provider and materializes its default model', () => {
  const dataDir = tmp();
  try {
    const next = setActiveProvider('ollama', { dataDir });
    assert.equal(next.activeProvider, 'ollama');
    // Materialized from the catalog preset (config-driven, not hardcoded here).
    assert.equal(next.providers.ollama?.model, loadCatalog().providers.ollama.defaultModel);

    const reloaded = loadSettings({ dataDir });
    assert.equal(reloaded.activeProvider, 'ollama');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('setActiveProvider: honors an explicit model override', () => {
  const dataDir = tmp();
  try {
    const next = setActiveProvider('ollama', { dataDir, model: 'mistral' });
    assert.equal(next.providers.ollama?.model, 'mistral');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('setActiveProvider: rejects an unknown provider id', () => {
  const dataDir = tmp();
  try {
    assert.throws(() => setActiveProvider('does-not-exist', { dataDir }), /unknown provider/i);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
