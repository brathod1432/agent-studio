import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeSecretKinds, detectSecrets, looksLikeSecret, redactSecrets } from './secretScan.ts';

test('detectSecrets: flags common credential shapes', () => {
  assert.deepEqual(detectSecrets('my key is nvapi-abcdef0123456789ABCDEF'), ['NVIDIA API key']);
  assert.deepEqual(detectSecrets('use sk-abcdef0123456789ABCDEFGH now'), ['OpenAI-style API key']);
  assert.deepEqual(detectSecrets('AKIAIOSFODNN7EXAMPLE'), ['AWS access key id']);
  assert.deepEqual(detectSecrets('Authorization: Bearer abcdefghijklmnop0123'), ['bearer token']);
  assert.ok(detectSecrets('-----BEGIN RSA PRIVATE KEY-----').includes('private key block'));
  assert.deepEqual(detectSecrets('password = hunter2secret'), ['credential assignment']);
  assert.deepEqual(detectSecrets('API_KEY: s3cr3t-value-here'), ['credential assignment']);
});

test('detectSecrets: ignores ordinary prose', () => {
  assert.deepEqual(detectSecrets('Can you review this function for bugs?'), []);
  assert.deepEqual(detectSecrets('The token of my appreciation is sincere.'), []);
  assert.equal(looksLikeSecret('just a normal message'), false);
});

test('detectSecrets: the reported kind never contains the secret value', () => {
  const secret = 'nvapi-SUPERSECRETVALUE0123456789';
  const kinds = detectSecrets(`here it is: ${secret}`);
  assert.ok(kinds.length > 0);
  for (const k of kinds) assert.ok(!k.includes('SUPERSECRETVALUE'));
});

test('describeSecretKinds: renders a readable list with articles', () => {
  assert.equal(describeSecretKinds(['bearer token']), 'a bearer token');
  assert.equal(describeSecretKinds(['NVIDIA API key']), 'an NVIDIA API key');
  assert.equal(
    describeSecretKinds(['NVIDIA API key', 'bearer token']),
    'an NVIDIA API key and a bearer token',
  );
});

test('redactSecrets: masks secret-looking values, leaves prose intact', () => {
  const redacted = redactSecrets('here is nvapi-ABCDEF0123456789ZZZZ and password = hunter2secret');
  assert.ok(!redacted.includes('nvapi-ABCDEF0123456789ZZZZ'));
  assert.ok(!redacted.includes('hunter2secret'));
  assert.match(redacted, /\[redacted:NVIDIA API key\]/);
  assert.equal(redactSecrets('just a normal message'), 'just a normal message');
});
