import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { ChatRequest, ChatResponse, LLMClient, StreamDeltaHandler, TokenUsage } from '../llm/types.ts';
import { ConversationStore } from '../memory/store.ts';
import { ChatAgent } from './chatAgent.ts';

/** Fake LLM client — records requests, avoids any network. */
class FakeLLM implements LLMClient {
  readonly providerId = 'fake';
  readonly model = 'fake-model';
  lastRequest?: ChatRequest;
  #streaming: boolean;
  #reply: string;
  #usage?: TokenUsage;

  constructor(reply = 'assistant reply', streaming = true, usage?: TokenUsage) {
    this.#reply = reply;
    this.#streaming = streaming;
    this.#usage = usage;
  }

  supportsStreaming(): boolean {
    return this.#streaming;
  }
  async validate(): Promise<boolean> {
    return true;
  }
  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.lastRequest = request;
    return { content: this.#reply, usage: this.#usage };
  }
  async chatStream(request: ChatRequest, onDelta: StreamDeltaHandler): Promise<ChatResponse> {
    this.lastRequest = request;
    for (const word of this.#reply.split(' ')) onDelta(word + ' ');
    return { content: this.#reply, usage: this.#usage };
  }
}

function setup(streaming = true, reply = 'assistant reply', usage?: TokenUsage) {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-agent-'));
  const store = new ConversationStore({ dataDir });
  const llm = new FakeLLM(reply, streaming, usage);
  const conversation = store.create({ providerId: 'nvidia', model: llm.model });
  const agent = new ChatAgent({ llm, store, conversation, systemPrompt: 'SYS' });
  return { dataDir, store, llm, conversation, agent };
}

test('run(): appends user + assistant messages and auto-persists', async () => {
  const { dataDir, store, agent, conversation, llm } = setup(false, 'Hi back');
  try {
    const out = await agent.run('Hello');
    assert.equal(out, 'Hi back');

    // Messages appended in order.
    assert.equal(conversation.messages.length, 2);
    assert.deepEqual(conversation.messages[0], { role: 'user', content: 'Hello' });
    assert.deepEqual(conversation.messages[1], { role: 'assistant', content: 'Hi back' });

    // System prompt is sent to the LLM but NOT stored in the conversation.
    assert.equal(llm.lastRequest?.messages[0]?.role, 'system');
    assert.equal(llm.lastRequest?.messages[0]?.content, 'SYS');
    assert.ok(!conversation.messages.some((m) => m.role === 'system'));

    // Persistence occurred automatically (reload from disk).
    const reloaded = store.load(conversation.id);
    assert.equal(reloaded.messages.length, 2);
    assert.equal(reloaded.title, 'Hello');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('runStream(): streams deltas, appends assistant message, persists', async () => {
  const { dataDir, store, agent, conversation } = setup(true, 'one two three');
  try {
    const deltas: string[] = [];
    const out = await agent.runStream('go', (d) => deltas.push(d));
    assert.equal(out, 'one two three');
    assert.ok(deltas.length >= 3, 'received streamed deltas');

    assert.equal(conversation.messages.length, 2);
    assert.equal(conversation.messages[1]?.role, 'assistant');
    assert.equal(conversation.messages[1]?.content, 'one two three');

    // Streaming did not break persistence.
    const reloaded = store.load(conversation.id);
    assert.equal(reloaded.messages.length, 2);
    assert.equal(reloaded.messages[1]?.content, 'one two three');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('runStream() falls back to chat when streaming is unsupported', async () => {
  const { dataDir, agent, conversation } = setup(false, 'full response');
  try {
    const deltas: string[] = [];
    const out = await agent.runStream('go', (d) => deltas.push(d));
    assert.equal(out, 'full response');
    assert.deepEqual(deltas, ['full response']); // single delta fallback
    assert.equal(conversation.messages[1]?.content, 'full response');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('conversation history accumulates across turns and is persisted', async () => {
  const { dataDir, store, agent, conversation } = setup(false, 'reply');
  try {
    await agent.run('first');
    await agent.run('second');
    assert.equal(conversation.messages.length, 4);
    const reloaded = store.load(conversation.id);
    assert.deepEqual(
      reloaded.messages.map((m) => m.role),
      ['user', 'assistant', 'user', 'assistant'],
    );
    // Second turn's request included prior history.
    assert.equal((store.load(conversation.id)).messages[2]?.content, 'second');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lastUsage: reports exact provider usage when available', async () => {
  const usage = { promptTokens: 7, completionTokens: 9, totalTokens: 16 };
  const { dataDir, agent } = setup(true, 'one two three', usage);
  try {
    await agent.runStream('go', () => {});
    assert.deepEqual(agent.lastUsage, usage);
    assert.equal(agent.lastUsageEstimated, false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('lastUsage: falls back to a positive estimate when the provider gives none', async () => {
  const { dataDir, agent } = setup(true, 'a fairly wordy assistant reply here');
  try {
    await agent.runStream('a decent length question', () => {});
    assert.equal(agent.lastUsageEstimated, true);
    assert.ok((agent.lastUsage?.promptTokens ?? 0) > 0);
    assert.ok((agent.lastUsage?.completionTokens ?? 0) > 0);
    assert.equal(
      agent.lastUsage?.totalTokens,
      (agent.lastUsage?.promptTokens ?? 0) + (agent.lastUsage?.completionTokens ?? 0),
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('maxContextTokens: trims old history from the request but keeps system + latest', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-agent-ctx-'));
  try {
    const store = new ConversationStore({ dataDir });
    const conversation = store.create({ providerId: 'nvidia', model: 'm' });
    // Seed a long history (10 messages of ~40 chars each).
    for (let i = 0; i < 10; i++) {
      store.append(conversation, { role: i % 2 === 0 ? 'user' : 'assistant', content: `${i}:` + 'x'.repeat(40) });
    }
    const llm = new FakeLLM('reply', false);
    const agent = new ChatAgent({ llm, store, conversation, systemPrompt: 'SYS', maxContextTokens: 40 });

    await agent.run('newest question');

    const sent = llm.lastRequest!.messages;
    assert.equal(sent[0]!.role, 'system'); // system prompt always kept
    assert.equal(sent[sent.length - 1]!.content, 'newest question'); // latest turn kept
    assert.ok(sent.length < 12, 'older history was trimmed from the request');
    assert.ok(agent.lastTrimmedCount > 0);

    // Stored history is untouched (full transcript remains on disk).
    const reloaded = store.load(conversation.id);
    assert.equal(reloaded.messages.length, 12); // 10 seeded + user + assistant
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('maxContextTokens: 0 (unlimited) sends the full history', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-agent-ctx0-'));
  try {
    const store = new ConversationStore({ dataDir });
    const conversation = store.create({ providerId: 'nvidia', model: 'm' });
    for (let i = 0; i < 6; i++) store.append(conversation, { role: 'user', content: `m${i}` });
    const llm = new FakeLLM('reply', false);
    const agent = new ChatAgent({ llm, store, conversation, systemPrompt: 'SYS', maxContextTokens: 0 });

    await agent.run('q');
    // system + 6 seeded + 1 new user = 8
    assert.equal(llm.lastRequest!.messages.length, 8);
    assert.equal(agent.lastTrimmedCount, 0);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/** LLM whose stream is cancelled partway, returning a partial reply. */
function cancellingLLM(partial: string): LLMClient {
  return {
    providerId: 'fake',
    model: 'fake-model',
    supportsStreaming: () => true,
    validate: async () => true,
    chat: async () => ({ content: partial, finishReason: 'cancelled' }),
    chatStream: async (_req: ChatRequest, onDelta: StreamDeltaHandler) => {
      if (partial) onDelta(partial);
      return { content: partial, finishReason: 'cancelled' };
    },
  };
}

test('runStream: a cancelled turn keeps the partial reply and persists it', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-agent-'));
  try {
    const store = new ConversationStore({ dataDir });
    const conversation = store.create({ providerId: 'nvidia', model: 'm' });
    const agent = new ChatAgent({ llm: cancellingLLM('partial answer'), store, conversation, systemPrompt: 'SYS' });
    const controller = new AbortController();

    const out = await agent.runStream('my question', () => {}, controller.signal);
    assert.equal(out, 'partial answer');

    // Persisted to disk: the question AND the partial answer.
    const reloaded = store.load(conversation.id);
    assert.equal(reloaded.messages.length, 2);
    assert.deepEqual(reloaded.messages[0], { role: 'user', content: 'my question' });
    assert.deepEqual(reloaded.messages[1], { role: 'assistant', content: 'partial answer' });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('ephemeral store (--no-save): a full turn runs but nothing is persisted', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-agent-eph-'));
  try {
    const store = new ConversationStore({ dataDir, ephemeral: true });
    const conversation = store.create({ providerId: 'nvidia', model: 'm' });
    const agent = new ChatAgent({ llm: new FakeLLM('a reply', false), store, conversation, systemPrompt: 'SYS' });

    const out = await agent.run('a sensitive question');
    assert.equal(out, 'a reply');
    // In-memory turn happened...
    assert.equal(conversation.messages.length, 2);
    // ...but nothing was written to disk.
    assert.equal(store.list().length, 0);
    assert.equal(store.tryLoad(conversation.id), undefined);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('runStream: a turn cancelled before any output still persists the question', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-agent-'));
  try {
    const store = new ConversationStore({ dataDir });
    const conversation = store.create({ providerId: 'nvidia', model: 'm' });
    const agent = new ChatAgent({ llm: cancellingLLM(''), store, conversation, systemPrompt: 'SYS' });

    const out = await agent.runStream('my question', () => {}, new AbortController().signal);
    assert.equal(out, '');

    // The question is saved (turn not lost); no empty assistant message added.
    const reloaded = store.load(conversation.id);
    assert.equal(reloaded.messages.length, 1);
    assert.deepEqual(reloaded.messages[0], { role: 'user', content: 'my question' });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
