import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { test } from 'node:test';

import { envRef, maskSecret, parseEnv, parseSecretRef, resolveSecret, Secret } from './secrets.ts';

test('maskSecret never reveals the full value', () => {
  assert.equal(maskSecret(undefined), '(not set)');
  assert.equal(maskSecret(''), '(not set)');
  assert.equal(maskSecret('short'), '********');
  assert.equal(maskSecret('abcdefgh_1234'), '****1234');
});

test('environment variable loading: parseEnv handles comments, quotes, blanks', () => {
  const env = parseEnv(
    ['# comment', '', 'NVIDIA_API_KEY=nvapi-abcdef123456', 'QUOTED="with spaces"', "SINGLE='v'", 'BAD LINE'].join('\n'),
  );
  assert.equal(env.NVIDIA_API_KEY, 'nvapi-abcdef123456');
  assert.equal(env.QUOTED, 'with spaces');
  assert.equal(env.SINGLE, 'v');
  assert.equal(env.BAD, undefined);
});

test('resolveSecret reads from env and wraps the value safely', () => {
  const resolved = resolveSecret('env:NVIDIA_API_KEY', { NVIDIA_API_KEY: 'nvapi-secretvalue-9999' });
  assert.equal(resolved.present, true);
  assert.equal(resolved.source, 'env:NVIDIA_API_KEY');
  assert.equal(resolved.secret?.reveal(), 'nvapi-secretvalue-9999');
  assert.equal(resolved.secret?.masked(), '****9999');
});

test('resolveSecret reports missing key without throwing', () => {
  const resolved = resolveSecret('env:NVIDIA_API_KEY', {});
  assert.equal(resolved.present, false);
  assert.equal(resolved.secret, undefined);
});

test('parseSecretRef only accepts env-backed refs', () => {
  assert.deepEqual(parseSecretRef('env:FOO'), { scheme: 'env', name: 'FOO', raw: 'env:FOO' });
  assert.deepEqual(parseSecretRef('FOO'), { scheme: 'env', name: 'FOO', raw: 'FOO' });
  assert.equal(parseSecretRef('file:/etc/x'), undefined);
  assert.equal(parseSecretRef(''), undefined);
  assert.equal(envRef('NVIDIA_API_KEY'), 'env:NVIDIA_API_KEY');
});

test('Secret does not leak via toString, JSON, or inspect', () => {
  const s = new Secret('nvapi-topsecret-abcd');
  assert.equal(`${s}`, '****abcd');
  assert.equal(JSON.stringify({ key: s }), JSON.stringify({ key: '****abcd' }));
  assert.ok(!inspect(s).includes('topsecret'));
  assert.ok(inspect(s).includes('****abcd'));
});
