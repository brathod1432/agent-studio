import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { JsonParseError } from '../core/jsonFile.ts';
import { loadCatalog } from './catalog.ts';
import { isFirstRun, loadSettings } from './store.ts';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'as-robust-'));
}

/** Capture console.warn output for the duration of a callback. */
function captureWarn(fn: () => void): string {
  const original = console.warn;
  let out = '';
  console.warn = (...args: unknown[]) => {
    out += args.map(String).join(' ') + '\n';
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return out;
}

test('settings with a UTF-8 BOM are honored, not silently ignored (S-4)', () => {
  const dataDir = tmp();
  try {
    const settings = {
      activeProvider: 'ollama',
      defaultModel: 'llama3.1',
      providers: {
        ollama: { id: 'ollama', label: 'Ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' },
      },
      request: { timeoutMs: 30000, maxRetries: 2, retryBaseDelayMs: 500 },
    };
    // Write WITH a byte-order mark (what PowerShell's Set-Content -utf8 produces).
    writeFileSync(join(dataDir, 'settings.json'), '\uFEFF' + JSON.stringify(settings), 'utf8');

    assert.equal(isFirstRun({ dataDir }), false);
    const loaded = loadSettings({ dataDir });
    // Before the fix this silently fell back to the default provider (nvidia).
    assert.equal(loaded.activeProvider, 'ollama');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('malformed settings warn clearly and fall back to defaults (not a silent revert)', () => {
  const dataDir = tmp();
  try {
    writeFileSync(join(dataDir, 'settings.json'), '{ this is : not valid json,,, }', 'utf8');

    let loaded!: ReturnType<typeof loadSettings>;
    const warned = captureWarn(() => {
      loaded = loadSettings({ dataDir });
    });
    // Falls back to the config default provider rather than crashing.
    assert.equal(loaded.activeProvider, 'nvidia');
    // And the user is told, clearly, that their file was ignored.
    assert.match(warned, /settings file/i);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a broken providers.json raises a clear JsonParseError (not a raw crash)', () => {
  const configDir = tmp();
  try {
    writeFileSync(join(configDir, 'providers.json'), '{ "providers": { oops }', 'utf8');
    assert.throws(
      () => loadCatalog(configDir),
      (err: unknown) => err instanceof JsonParseError && /providers\.json/.test(err.message),
    );
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});
