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
