import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadCatalog } from '../config/catalog.ts';
import type { AppSettings } from '../config/types.ts';
import { jsonResponse, recordingFetch } from '../../testkit/mockFetch.ts';
import { OnboardingSession } from './onboarding.ts';

const MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const RAW_KEY = 'nvapi-onboarding-key-5678';

function newSession(fetchImpl: ReturnType<typeof recordingFetch>['fetch']) {
  return new OnboardingSession({
    catalog: loadCatalog(),
    env: {}, // key is NOT in env; user will type it
    health: { fetchImpl, request: { timeoutMs: 50, maxRetries: 0, retryBaseDelayMs: 1 } },
  });
}

test('full onboarding flow reaches complete and never persists the raw key', async () => {
  const { fetch } = recordingFetch(jsonResponse(200, { data: [{ id: MODEL }] }));
  const session = newSession(fetch);

  // Step 1
  assert.equal(session.step, 'choose_provider');
  let r = session.chooseProvider('nvidia');
  assert.equal(r.ok, true);
  assert.equal(session.step, 'enter_credentials');

  // Step 2: user provides a key transiently.
  session.provideApiKey(RAW_KEY, 'NVIDIA_API_KEY');
  r = session.confirmCredentials();
  assert.equal(r.ok, true);
  assert.equal(session.step, 'select_model');

  // Step 3
  r = session.selectModel(MODEL);
  assert.equal(r.ok, true);

  // Step 4: connection test uses the transient key (merged into env internally).
  const test4 = await session.runTest();
  assert.equal(test4.ok, true);
  const report = session.lastReport!;
  assert.equal(report.overall, 'ok');
  // The report shows a masked key, never the raw value.
  assert.equal(report.provider.apiKeyMasked, '****5678');
  assert.ok(!JSON.stringify(report).includes(RAW_KEY), 'report must not contain the raw key');

  // Step 5: build settings — apiKeyRef only, no key value.
  const { config } = session.complete();
  assert.equal(config.apiKeyRef, 'env:NVIDIA_API_KEY');
  assert.ok(!('apiKey' in config));

  const base: AppSettings = {
    activeProvider: undefined,
    defaultModel: '',
    providers: {},
    request: { timeoutMs: 30000, maxRetries: 2, retryBaseDelayMs: 500 },
  };
  const settings = session.buildSettings(base);
  assert.equal(settings.activeProvider, 'nvidia');
  assert.equal(settings.providers.nvidia?.model, MODEL);
  assert.ok(!JSON.stringify(settings).includes(RAW_KEY), 'settings must not contain the raw key');

  // The raw key is only retrievable via the explicit persistence method.
  assert.equal(session.hasTransientKey(), true);
  assert.equal(session.revealApiKeyForPersistence(), RAW_KEY);
});

test('missing required credentials blocks progression', () => {
  const { fetch } = recordingFetch(jsonResponse(200, { data: [] }));
  const session = newSession(fetch);
  session.chooseProvider('nvidia'); // requires a key
  const r = session.confirmCredentials(); // no key provided, none in env
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /API key is required/);
  assert.equal(session.step, 'enter_credentials');
});

test('custom provider requires a base URL before proceeding', () => {
  const { fetch } = recordingFetch(jsonResponse(200, { data: [] }));
  const session = newSession(fetch);
  session.chooseProvider('custom'); // no base URL, no key required
  const r = session.confirmCredentials();
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /base URL is required/i);
});
