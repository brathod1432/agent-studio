import assert from 'node:assert/strict';
import { test } from 'node:test';

import { providerConfigFromPreset } from '../config/store.ts';
import { loadCatalog } from '../config/catalog.ts';
import type { ProviderConfig, RequestSettings } from '../config/types.ts';
import { healthCheck, listProviderModels, testConnection, validateModel } from './testing.ts';
import { ProviderError } from './errors.ts';
import { abortingFetch, failingFetch, jsonResponse, recordingFetch, textResponse } from '../../testkit/mockFetch.ts';

const REQUEST: RequestSettings = { timeoutMs: 50, maxRetries: 0, retryBaseDelayMs: 1 };
const MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';

function nvidiaConfig(): ProviderConfig {
  return providerConfigFromPreset(loadCatalog().providers.nvidia);
}

const KEYED_ENV = { NVIDIA_API_KEY: 'nvapi-test-key-abcd1234' };

test('connection validation: 200 + model list => ok, models discovered', async () => {
  const { fetch, calls } = recordingFetch(jsonResponse(200, { data: [{ id: MODEL }, { id: 'other/model' }] }));
  const result = await testConnection(nvidiaConfig(), { request: REQUEST, fetchImpl: fetch, env: KEYED_ENV });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');
  assert.ok(result.models?.some((m) => m.id === MODEL));
  // It called the /models endpoint with a bearer header.
  assert.match(calls[0]!.url, /\/models$/);
  const auth = (calls[0]!.init?.headers as Record<string, string>).Authorization;
  assert.equal(auth, 'Bearer nvapi-test-key-abcd1234');
});

test('model validation detects present/absent/unverifiable models', () => {
  assert.equal(validateModel(MODEL, [{ id: MODEL }]).status, 'ok');
  assert.equal(validateModel(MODEL, [{ id: 'other' }]).status, 'warn');
  assert.equal(validateModel(MODEL, []).status, 'warn');
  assert.equal(validateModel('', [{ id: MODEL }]).status, 'error');
});

test('health check aggregates connection + model validation', async () => {
  const { fetch } = recordingFetch(jsonResponse(200, { data: [{ id: MODEL }] }));
  const report = await healthCheck(nvidiaConfig(), { request: REQUEST, fetchImpl: fetch, env: KEYED_ENV });
  assert.equal(report.overall, 'ok');
  assert.equal(report.provider.model, MODEL);
  assert.equal(report.provider.apiKeyMasked, '****1234');
  assert.ok(report.checks.some((c) => c.name === 'model' && c.status === 'ok'));
});

test('missing key handling: no key => missing_api_key, fetch not called', async () => {
  const result = await testConnection(nvidiaConfig(), {
    request: REQUEST,
    fetchImpl: failingFetch(),
    env: {}, // no NVIDIA_API_KEY
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, 'missing_api_key');
  assert.ok(result.checks.some((c) => c.name === 'api_key' && c.status === 'error'));
});

test('invalid key handling: 401 => invalid_api_key', async () => {
  const { fetch } = recordingFetch(textResponse(401, 'unauthorized'));
  const result = await testConnection(nvidiaConfig(), { request: REQUEST, fetchImpl: fetch, env: KEYED_ENV });
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, 'invalid_api_key');
  assert.equal(result.error?.status, 401);
  assert.equal(result.error?.retryable, false);
});

test('rate limit handling: 429 => rate_limit with retry-after', async () => {
  const { fetch } = recordingFetch(textResponse(429, 'slow down', { 'retry-after': '7' }));
  const result = await testConnection(nvidiaConfig(), { request: REQUEST, fetchImpl: fetch, env: KEYED_ENV });
  assert.equal(result.error?.kind, 'rate_limit');
  assert.equal(result.error?.retryAfterSeconds, 7);
  assert.equal(result.error?.retryable, true);
});

test('timeout handling: aborted request => timeout error', async () => {
  const result = await testConnection(nvidiaConfig(), {
    request: { ...REQUEST, timeoutMs: 10 },
    fetchImpl: abortingFetch(),
    env: KEYED_ENV,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, 'timeout');
  assert.equal(result.error?.retryable, true);
});

test('server error handling: 500 => retryable server error', async () => {
  const { fetch } = recordingFetch(textResponse(500, 'boom'));
  const result = await testConnection(nvidiaConfig(), { request: REQUEST, fetchImpl: fetch, env: KEYED_ENV });
  assert.equal(result.error?.kind, 'server');
  assert.equal(result.error?.retryable, true);
});

test('local provider (no key required) connects without a key', async () => {
  const ollama = providerConfigFromPreset(loadCatalog().providers.ollama);
  const { fetch } = recordingFetch(jsonResponse(200, { data: [{ id: 'llama3.1' }] }));
  const result = await testConnection(ollama, { request: REQUEST, fetchImpl: fetch, env: {} });
  assert.equal(result.ok, true);
});

test('listProviderModels: returns model ids and sends a bearer header', async () => {
  const { fetch, calls } = recordingFetch(
    jsonResponse(200, { data: [{ id: 'a/model' }, { id: 'b/model', owned_by: 'b' }] }),
  );
  const models = await listProviderModels(nvidiaConfig(), { request: REQUEST, fetchImpl: fetch, env: KEYED_ENV });
  assert.deepEqual(models.map((m) => m.id), ['a/model', 'b/model']);
  assert.match(calls[0]!.url, /\/models$/);
  const auth = (calls[0]!.init?.headers as Record<string, string>).Authorization;
  assert.equal(auth, 'Bearer nvapi-test-key-abcd1234');
});

test('listProviderModels: surfaces a normalized error on 401', async () => {
  const { fetch } = recordingFetch(textResponse(401, 'unauthorized'));
  await assert.rejects(
    () => listProviderModels(nvidiaConfig(), { request: REQUEST, fetchImpl: fetch, env: KEYED_ENV }),
    (err: unknown) => err instanceof ProviderError && err.kind === 'invalid_api_key',
  );
});
