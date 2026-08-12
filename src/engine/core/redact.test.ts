import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Logger } from './logger.ts';
import { clearRegisteredSecrets, redact, registerSecretValue, scrubString } from './redact.ts';
import { Secret } from './secrets.ts';

test('redact masks sensitive keys regardless of value', () => {
  const out = redact({
    api_key: 'nvapi-should-not-appear',
    Authorization: 'Bearer nvapi-should-not-appear',
    nested: { token: 'abcdef123456', keep: 'visible' },
    normal: 'hello',
  }) as Record<string, unknown>;
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes('should-not-appear'), 'sensitive value must be masked');
  assert.ok(serialized.includes('visible'), 'non-sensitive values are preserved');
  assert.equal((out.normal as string), 'hello');
});

test('redact renders Secret as masked', () => {
  const out = redact({ s: new Secret('nvapi-secret-7777') }) as Record<string, unknown>;
  assert.equal(out.s, '****7777');
});

test('scrubString removes registered secret substrings', () => {
  clearRegisteredSecrets();
  registerSecretValue('nvapi-registered-secret-1234');
  const scrubbed = scrubString('the key is nvapi-registered-secret-1234 in the log');
  assert.ok(!scrubbed.includes('nvapi-registered-secret-1234'));
  clearRegisteredSecrets();
});

test('Logger never prints a registered secret', () => {
  clearRegisteredSecrets();
  const lines: string[] = [];
  const logger = new Logger({ level: 'debug', sink: (_l, line) => lines.push(line) });
  registerSecretValue('nvapi-supersecret-value-0001');
  logger.info('connecting with nvapi-supersecret-value-0001', {
    authorization: 'Bearer nvapi-supersecret-value-0001',
    model: 'nvidia/nemotron',
  });
  const all = lines.join('\n');
  assert.ok(!all.includes('nvapi-supersecret-value-0001'), 'secret must never appear in logs');
  assert.ok(all.includes('nvidia/nemotron'), 'non-secret metadata is preserved');
  clearRegisteredSecrets();
});
