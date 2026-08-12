import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { conversationsDir } from './persistence.ts';
import { ConversationStore, deriveTitle } from './store.ts';

function tempStore(): { store: ConversationStore; dataDir: string } {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-mem-'));
  return { store: new ConversationStore({ dataDir }), dataDir };
}

test('create conversation: has id, timestamps, empty messages', () => {
  const { store, dataDir } = tempStore();
  try {
    const conv = store.create({ providerId: 'nvidia', model: 'm' });
    assert.match(conv.id, /[0-9a-f-]{36}/);
    assert.equal(conv.messages.length, 0);
    assert.ok(conv.createdAt);
    assert.equal(conv.providerId, 'nvidia');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('save + load conversation: JSON round-trips under conversations dir', () => {
  const { store, dataDir } = tempStore();
  try {
    const conv = store.create({ providerId: 'nvidia', model: 'm' });
    store.append(conv, { role: 'user', content: 'Hello' });
    store.append(conv, { role: 'assistant', content: 'Hi!' });
    const path = store.save(conv);

    assert.ok(path.startsWith(conversationsDir({ dataDir })));
    assert.ok(existsSync(path));
    const raw = readFileSync(path, 'utf8');
    assert.ok(raw.includes('"role": "user"')); // human-readable, pretty-printed

    const loaded = store.load(conv.id);
    assert.equal(loaded.id, conv.id);
    assert.equal(loaded.messages.length, 2);
    assert.deepEqual(loaded.messages[0], { role: 'user', content: 'Hello' });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('title is derived from the first user message', () => {
  const { store, dataDir } = tempStore();
  try {
    const conv = store.create();
    assert.equal(conv.title, 'New conversation');
    store.append(conv, { role: 'user', content: 'How do I configure the provider?' });
    assert.equal(conv.title, 'How do I configure the provider?');
    assert.equal(deriveTitle('  spaced   out  '), 'spaced out');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('resume conversation: list is sorted and load restores history', () => {
  const { store, dataDir } = tempStore();
  try {
    const a = store.create();
    store.append(a, { role: 'user', content: 'first' });
    store.save(a);
    const b = store.create();
    store.append(b, { role: 'user', content: 'second' });
    store.save(b);

    const list = store.list();
    assert.equal(list.length, 2);
    // Most recently updated first.
    assert.equal(list[0]!.id, b.id);
    assert.equal(list[0]!.messageCount, 1);

    const resumed = store.load(a.id);
    assert.equal(resumed.messages[0]!.content, 'first');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('load throws for a missing conversation; delete removes the file', () => {
  const { store, dataDir } = tempStore();
  try {
    assert.throws(() => store.load('does-not-exist'));
    const conv = store.create();
    store.save(conv);
    assert.equal(store.delete(conv.id), true);
    assert.equal(store.tryLoad(conv.id), undefined);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('ephemeral store: save is a no-op and writes nothing to disk', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-mem-eph-'));
  try {
    const store = new ConversationStore({ dataDir, ephemeral: true });
    const conv = store.create({ providerId: 'nvidia', model: 'm' });
    store.append(conv, { role: 'user', content: 'secret question' });
    const path = store.save(conv);
    assert.equal(path, ''); // nothing persisted
    assert.equal(existsSync(conversationsDir({ dataDir })), false);
    assert.equal(store.list().length, 0);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
