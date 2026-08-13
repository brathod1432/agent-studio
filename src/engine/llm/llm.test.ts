import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadCatalog } from '../config/catalog.ts';
import { providerConfigFromPreset } from '../config/store.ts';
import type { ProviderConfig, RequestSettings } from '../config/types.ts';
import {
  abortingFetch,
  blockingSseFetch,
  chatCompletionResponse,
  jsonResponse,
  recordingFetch,
  sseChatResponse,
  textResponse,
} from '../../testkit/mockFetch.ts';
import { createLLMClient } from './factory.ts';
import { NvidiaClient } from './providers/nvidiaClient.ts';
import { OpenAICompatibleChatClient } from './providers/openAICompatibleClient.ts';

const REQUEST: RequestSettings = { timeoutMs: 50, maxRetries: 0, retryBaseDelayMs: 1 };
const KEY = 'nvapi-test-key-abcd1234';

function nvidiaConfig(): ProviderConfig {
  return providerConfigFromPreset(loadCatalog().providers.nvidia);
}

test('factory: provider selection picks the NVIDIA client for the nvidia provider', () => {
  const nvidia = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST });
  assert.ok(nvidia instanceof NvidiaClient);
  assert.equal(nvidia.providerId, 'nvidia');

  const ollamaCfg = providerConfigFromPreset(loadCatalog().providers.ollama);
  const generic = createLLMClient({ config: ollamaCfg, apiKey: undefined, request: REQUEST });
  assert.ok(generic instanceof OpenAICompatibleChatClient);
  assert.ok(!(generic instanceof NvidiaClient));
});

test('model selection: client.model comes from provider config', () => {
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST });
  assert.equal(client.model, 'nvidia/nemotron-3.5-lightning-30b-a3b');
});

test('request creation: chat posts model, messages, bearer auth', async () => {
  const { fetch, calls } = recordingFetch(chatCompletionResponse('Hello there'));
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST, fetchImpl: fetch });
  const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });

  assert.equal(res.content, 'Hello there');
  assert.match(calls[0]!.url, /\/chat\/completions$/);
  const body = JSON.parse(String(calls[0]!.init?.body));
  assert.equal(body.model, 'nvidia/nemotron-3.5-lightning-30b-a3b');
  assert.equal(body.stream, false);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
  const headers = calls[0]!.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
});

test('model override in the request is honored', async () => {
  const { fetch, calls } = recordingFetch(chatCompletionResponse('ok'));
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST, fetchImpl: fetch });
  await client.chat({ messages: [{ role: 'user', content: 'x' }], model: 'nvidia/other-model' });
  assert.equal(JSON.parse(String(calls[0]!.init?.body)).model, 'nvidia/other-model');
});

test('chatWithTools advertises tools and parses tool_calls', async () => {
  const toolResponse = jsonResponse(200, {
    choices: [
      {
        message: {
          content: '',
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'text.stats', arguments: '{"text":"a b"}' } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
  });
  const { fetch, calls } = recordingFetch(toolResponse);
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST, fetchImpl: fetch });
  const tools = [{ type: 'function' as const, function: { name: 'text.stats', parameters: {} } }];
  const res = await client.chatWithTools({ messages: [{ role: 'user', content: 'count a b' }], tools });
  assert.equal(res.toolCalls?.length, 1);
  assert.equal(res.toolCalls?.[0]?.name, 'text.stats');
  assert.equal(res.toolCalls?.[0]?.arguments, '{"text":"a b"}');
  const body = JSON.parse(String(calls[0]!.init?.body));
  assert.deepEqual(body.tools, tools);
  assert.equal(body.tool_choice, 'auto');
});

test('maxTokens is sent as max_tokens when positive, omitted otherwise', async () => {
  const capped = recordingFetch(chatCompletionResponse('ok'));
  const c1 = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST, fetchImpl: capped.fetch });
  await c1.chat({ messages: [{ role: 'user', content: 'x' }], maxTokens: 128 });
  assert.equal(JSON.parse(String(capped.calls[0]!.init?.body)).max_tokens, 128);

  const none = recordingFetch(chatCompletionResponse('ok'));
  const c2 = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST, fetchImpl: none.fetch });
  await c2.chat({ messages: [{ role: 'user', content: 'x' }], maxTokens: 0 });
  assert.equal('max_tokens' in JSON.parse(String(none.calls[0]!.init?.body)), false);
});

test('validate() returns true on reachable/authorized endpoint, false on 401', async () => {
  const okClient = createLLMClient({
    config: nvidiaConfig(),
    apiKey: KEY,
    request: REQUEST,
    fetchImpl: recordingFetch(jsonResponse(200, { data: [{ id: 'm' }] })).fetch,
  });
  assert.equal(await okClient.validate(), true);

  const badClient = createLLMClient({
    config: nvidiaConfig(),
    apiKey: KEY,
    request: REQUEST,
    fetchImpl: recordingFetch(textResponse(401, 'nope')).fetch,
  });
  assert.equal(await badClient.validate(), false);
});

test('streaming: chatStream emits deltas and returns the full content', async () => {
  const { fetch, calls } = recordingFetch(sseChatResponse(['Hello', ', ', 'world']));
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST, fetchImpl: fetch });

  const deltas: string[] = [];
  const res = await client.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, (d) => deltas.push(d));

  assert.deepEqual(deltas, ['Hello', ', ', 'world']);
  assert.equal(res.content, 'Hello, world');
  const body = JSON.parse(String(calls[0]!.init?.body));
  assert.equal(body.stream, true);
  // Requests a final usage chunk from OpenAI-compatible endpoints.
  assert.deepEqual(body.stream_options, { include_usage: true });
});

test('streaming: captures exact token usage from the final usage chunk', async () => {
  const { fetch } = recordingFetch(
    sseChatResponse(['Hi'], 'test-model', { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 }),
  );
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST, fetchImpl: fetch });
  const res = await client.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, () => {});
  assert.deepEqual(res.usage, { promptTokens: 11, completionTokens: 22, totalTokens: 33 });
});

test('streaming: usage is undefined when the endpoint sends no usage chunk', async () => {
  const { fetch } = recordingFetch(sseChatResponse(['Hi']));
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST, fetchImpl: fetch });
  const res = await client.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, () => {});
  assert.equal(res.usage, undefined);
});

test('streaming: aborting mid-stream returns the partial reply, not an error', async () => {
  const client = createLLMClient({
    config: nvidiaConfig(),
    apiKey: KEY,
    request: REQUEST,
    fetchImpl: blockingSseFetch(['Partial answer']),
  });
  const controller = new AbortController();
  const deltas: string[] = [];
  // Cancel right after the first delta streams in.
  const res = await client.chatStream(
    { messages: [{ role: 'user', content: 'hi' }], signal: controller.signal },
    (d) => {
      deltas.push(d);
      controller.abort();
    },
  );
  assert.deepEqual(deltas, ['Partial answer']);
  assert.equal(res.content, 'Partial answer');
  assert.equal(res.finishReason, 'cancelled');
});

test('streaming: a pre-aborted signal yields an empty cancelled response', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = createLLMClient({
    config: nvidiaConfig(),
    apiKey: KEY,
    request: REQUEST,
    fetchImpl: blockingSseFetch(['never seen']),
  });
  const res = await client.chatStream(
    { messages: [{ role: 'user', content: 'hi' }], signal: controller.signal },
    () => {},
  );
  assert.equal(res.content, '');
  assert.equal(res.finishReason, 'cancelled');
});

const REQUEST_RETRY: RequestSettings = { timeoutMs: 50, maxRetries: 2, retryBaseDelayMs: 1 };

test('retry: chat retries a transient 503 then succeeds', async () => {
  let n = 0;
  const { fetch, calls } = recordingFetch(() =>
    n++ === 0 ? textResponse(503, 'busy') : chatCompletionResponse('recovered'),
  );
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST_RETRY, fetchImpl: fetch });
  const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.content, 'recovered');
  assert.equal(calls.length, 2); // one failure + one success
});

test('retry: chat honors Retry-After on 429 then succeeds', async () => {
  let n = 0;
  const { fetch, calls } = recordingFetch(() =>
    n++ === 0 ? textResponse(429, 'slow', { 'retry-after': '0' }) : chatCompletionResponse('ok'),
  );
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST_RETRY, fetchImpl: fetch });
  const res = await client.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(res.content, 'ok');
  assert.equal(calls.length, 2);
});

test('retry: chat does NOT retry a non-retryable 401', async () => {
  const { fetch, calls } = recordingFetch(textResponse(401, 'nope'));
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST_RETRY, fetchImpl: fetch });
  await assert.rejects(
    () => client.chat({ messages: [{ role: 'user', content: 'x' }] }),
    (err: unknown) => (err as { kind?: string }).kind === 'invalid_api_key',
  );
  assert.equal(calls.length, 1); // no retries
});

test('retry: chat gives up after maxRetries and throws', async () => {
  const { fetch, calls } = recordingFetch(textResponse(500, 'boom'));
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST_RETRY, fetchImpl: fetch });
  await assert.rejects(
    () => client.chat({ messages: [{ role: 'user', content: 'x' }] }),
    (err: unknown) => (err as { kind?: string }).kind === 'server',
  );
  assert.equal(calls.length, REQUEST_RETRY.maxRetries + 1); // initial + retries
});

test('retry: chatStream retries connection failure then streams (no duplicate output)', async () => {
  let n = 0;
  const { fetch, calls } = recordingFetch(() =>
    n++ === 0 ? textResponse(503, 'busy') : sseChatResponse(['Hello', ' world']),
  );
  const client = createLLMClient({ config: nvidiaConfig(), apiKey: KEY, request: REQUEST_RETRY, fetchImpl: fetch });
  const deltas: string[] = [];
  const res = await client.chatStream({ messages: [{ role: 'user', content: 'hi' }] }, (d) => deltas.push(d));
  assert.equal(res.content, 'Hello world');
  assert.deepEqual(deltas, ['Hello', ' world']); // emitted exactly once
  assert.equal(calls.length, 2);
});

test('runtime errors: normalized taxonomy for missing key, 401, 429, timeout, network, 5xx', async () => {
  // Missing key: fetch must not be called.
  const missing = createLLMClient({
    config: nvidiaConfig(),
    apiKey: undefined,
    request: REQUEST,
    fetchImpl: async () => {
      throw new Error('should not be called');
    },
  });
  await assert.rejects(() => missing.chat({ messages: [{ role: 'user', content: 'x' }] }), /No API key/);

  const cases: Array<[string, ReturnType<typeof recordingFetch>['fetch'] | ReturnType<typeof abortingFetch>]> = [
    ['invalid_api_key', recordingFetch(textResponse(401, 'unauthorized')).fetch],
    ['rate_limit', recordingFetch(textResponse(429, 'slow', { 'retry-after': '3' })).fetch],
    ['server', recordingFetch(textResponse(500, 'boom')).fetch],
    ['timeout', abortingFetch()],
    ['network', (async () => {
        const e = new Error('down') as Error & { code?: string };
        e.code = 'ECONNREFUSED';
        throw e;
      }) as ReturnType<typeof recordingFetch>['fetch']],
  ];

  for (const [kind, fetchImpl] of cases) {
    const client = createLLMClient({
      config: nvidiaConfig(),
      apiKey: KEY,
      request: { ...REQUEST, timeoutMs: 10 },
      fetchImpl,
    });
    await assert.rejects(
      () => client.chat({ messages: [{ role: 'user', content: 'x' }] }),
      (err: unknown) => (err as { kind?: string }).kind === kind,
      `expected error kind "${kind}"`,
    );
  }
});
