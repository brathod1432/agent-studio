import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { conversationToMarkdown, defaultExportFilename } from './export.ts';
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

test('rename: updates the title and persists it', () => {
  const { store, dataDir } = tempStore();
  try {
    const conv = store.create();
    store.append(conv, { role: 'user', content: 'hello' });
    store.save(conv);
    const renamed = store.rename(conv.id, '  My important chat  ');
    assert.equal(renamed.title, 'My important chat');
    assert.equal(store.load(conv.id).title, 'My important chat');
    assert.throws(() => store.rename(conv.id, '   '), /non-empty title/i);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('search: matches titles and message contents (case-insensitive) with a snippet', () => {
  const { store, dataDir } = tempStore();
  try {
    const a = store.create({ title: 'Deploy runbook' });
    store.append(a, { role: 'user', content: 'How do I roll back a Kubernetes deployment?' });
    store.save(a);
    const b = store.create({ title: 'Cooking' });
    store.append(b, { role: 'user', content: 'Best pasta recipe' });
    store.save(b);

    // Matches a message body, case-insensitively, and returns a snippet.
    const byMsg = store.search('kubernetes');
    assert.equal(byMsg.length, 1);
    assert.equal(byMsg[0]!.id, a.id);
    assert.equal(byMsg[0]!.matchedIn, 'message');
    assert.match(byMsg[0]!.snippet!, /Kubernetes/);

    // Matches a title.
    const byTitle = store.search('cooking');
    assert.equal(byTitle.length, 1);
    assert.equal(byTitle[0]!.matchedIn, 'title');

    // Empty query returns nothing.
    assert.deepEqual(store.search('   '), []);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('conversationToMarkdown: renders title, metadata, and role headings', () => {
  const { store, dataDir } = tempStore();
  try {
    const conv = store.create({ providerId: 'nvidia', model: 'test-model', title: 'Chat A' });
    store.append(conv, { role: 'user', content: 'ping' });
    store.append(conv, { role: 'assistant', content: 'pong' });
    const md = conversationToMarkdown(conv);
    assert.match(md, /^# Chat A/);
    assert.match(md, /- Model: test-model/);
    assert.match(md, /### You\n\nping/);
    assert.match(md, /### Assistant\n\npong/);

    const name = defaultExportFilename(conv);
    assert.match(name, /^chat-a-[0-9a-f]{8}\.md$/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('save is atomic: no leftover temp files, only the final .json remains', () => {
  const { store, dataDir } = tempStore();
  try {
    const conv = store.create({ providerId: 'nvidia', model: 'm' });
    store.append(conv, { role: 'user', content: 'hi' });
    store.save(conv);
    const files = readdirSync(conversationsDir({ dataDir }));
    assert.deepEqual(files, [`${conv.id}.json`]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a corrupt conversation file is skipped (kept on disk), not silently lost', () => {
  const { store, dataDir } = tempStore();
  try {
    const good = store.create();
    store.append(good, { role: 'user', content: 'ok' });
    store.save(good);
    const dir = conversationsDir({ dataDir });
    writeFileSync(join(dir, 'deadbeef.json'), '{ not json', 'utf8');

    const list = store.list();
    assert.equal(list.length, 1); // the good one is still listed
    assert.ok(existsSync(join(dir, 'deadbeef.json'))); // corrupt file preserved
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('saved conversation files are owner-only (0600) on POSIX', (t) => {
  if (process.platform === 'win32') {
    t.skip('chmod bits are not meaningful on Windows');
    return;
  }
  const { store, dataDir } = tempStore();
  try {
    const conv = store.create();
    store.append(conv, { role: 'user', content: 'x' });
    const path = store.save(conv);
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600);
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
