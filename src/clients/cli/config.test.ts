import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyTunable,
  isTunableKey,
  readTunable,
  resolveChoice,
  TUNABLE_KEYS,
} from './config.ts';
import type { AppSettings } from '../../engine/index.ts';

const IDS = ['nvidia/a', 'nvidia/b', 'nvidia/c'];

test('resolveChoice: maps a 1-based index to an id', () => {
  assert.equal(resolveChoice('1', IDS), 'nvidia/a');
  assert.equal(resolveChoice('3', IDS), 'nvidia/c');
});

test('resolveChoice: matches an exact id', () => {
  assert.equal(resolveChoice('nvidia/b', IDS), 'nvidia/b');
});

test('resolveChoice: returns undefined for blanks and out-of-range/unknown input', () => {
  assert.equal(resolveChoice('', IDS), undefined);
  assert.equal(resolveChoice('   ', IDS), undefined);
  assert.equal(resolveChoice('0', IDS), undefined);
  assert.equal(resolveChoice('99', IDS), undefined);
  assert.equal(resolveChoice('nope', IDS), undefined);
});

function fakeSettings(): AppSettings {
  return {
    activeProvider: 'nvidia',
    defaultModel: 'm',
    providers: {},
    request: { timeoutMs: 30000, maxRetries: 2, retryBaseDelayMs: 500 },
    maxContextTokens: 16000,
    maxOutputTokens: 0,
  };
}

test('isTunableKey recognizes known keys only', () => {
  assert.equal(isTunableKey('maxOutputTokens'), true);
  assert.equal(isTunableKey('request.timeoutMs'), true);
  assert.equal(isTunableKey('bogus'), false);
});

test('readTunable / applyTunable round-trip top-level and nested request keys', () => {
  const s = fakeSettings();
  assert.equal(readTunable(s, 'maxOutputTokens'), 0);
  applyTunable(s, 'maxOutputTokens', 512);
  assert.equal(readTunable(s, 'maxOutputTokens'), 512);

  assert.equal(readTunable(s, 'request.timeoutMs'), 30000);
  applyTunable(s, 'request.timeoutMs', 60000);
  assert.equal(s.request.timeoutMs, 60000);

  // Every advertised key is readable and writable.
  for (const k of TUNABLE_KEYS) {
    applyTunable(s, k, 7);
    assert.equal(readTunable(s, k), 7);
  }
});
