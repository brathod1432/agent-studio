import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { expandFileReferences, extractFileRefs, isSensitivePath, type FileReader } from './fileContext.ts';

const neverRead: FileReader = () => {
  throw new Error('reader should not be called for a blocked file');
};

test('extractFileRefs: finds @tokens (incl. quoted) and ignores emails', () => {
  assert.deepEqual(extractFileRefs('explain @src/a.ts and @b.md'), ['src/a.ts', 'b.md']);
  assert.deepEqual(extractFileRefs('see @"my notes.md" please'), ['my notes.md']);
  assert.deepEqual(extractFileRefs('mail me at user@example.com'), []); // not preceded by whitespace/start
  assert.deepEqual(extractFileRefs('no refs here'), []);
});

test('extractFileRefs: de-duplicates repeated references', () => {
  assert.deepEqual(extractFileRefs('@a.ts vs @a.ts again'), ['a.ts']);
});

test('expandFileReferences: appends file contents as delimited blocks', () => {
  const read: FileReader = (p) => ({ content: p.endsWith('a.ts') ? 'AAA' : 'BBB', truncated: false, bytes: 3 });
  const { text, refs } = expandFileReferences('review @a.ts and @b.ts', { cwd: '/work', read });

  assert.equal(refs.length, 2);
  assert.ok(refs.every((r) => r.ok));
  assert.match(text, /^review @a\.ts and @b\.ts/); // original instruction preserved
  assert.match(text, /File: a\.ts\n```\nAAA\n```/);
  assert.match(text, /File: b\.ts\n```\nBBB\n```/);
});

test('expandFileReferences: no references returns the input unchanged', () => {
  const { text, refs } = expandFileReferences('just a question', { read: () => ({ content: '', truncated: false, bytes: 0 }) });
  assert.equal(text, 'just a question');
  assert.deepEqual(refs, []);
});

test('expandFileReferences: a missing file is reported, not thrown, and not appended', () => {
  const read: FileReader = () => {
    throw new Error('ENOENT: no such file');
  };
  const { text, refs } = expandFileReferences('look at @missing.txt', { read });
  assert.equal(refs[0]!.ok, false);
  assert.match(refs[0]!.error!, /ENOENT/);
  assert.equal(text, 'look at @missing.txt'); // unchanged (nothing to append)
});

test('expandFileReferences: marks truncation when the reader caps the file', () => {
  const read: FileReader = () => ({ content: 'partial', truncated: true, bytes: 999999 });
  const { text, refs } = expandFileReferences('@big.log', { read, maxBytes: 7 });
  assert.equal(refs[0]!.truncated, true);
  assert.match(text, /truncated to 7 bytes/);
});

test('isSensitivePath: flags credentials/keys and ssh/aws dirs', () => {
  assert.equal(isSensitivePath('/proj/.env'), true);
  assert.equal(isSensitivePath('/proj/.env.local'), true);
  assert.equal(isSensitivePath('/home/u/.ssh/id_rsa'), true);
  assert.equal(isSensitivePath('/home/u/.aws/credentials'), true);
  assert.equal(isSensitivePath('/proj/server.pem'), true);
  assert.equal(isSensitivePath('/proj/src/app.ts'), false);
});

test('@file safety: refuses files outside the workspace root (default deny)', () => {
  const res = expandFileReferences('read @../secret.txt', {
    cwd: '/work/proj',
    workspaceRoot: '/work/proj',
    read: neverRead,
  });
  assert.equal(res.refs[0]!.ok, false);
  assert.equal(res.refs[0]!.blocked, true);
  assert.match(res.refs[0]!.error!, /outside the workspace/);
  assert.equal(res.text, 'read @../secret.txt'); // nothing appended
});

test('@file safety: refuses sensitive files even inside the workspace', () => {
  const res = expandFileReferences('read @.env', {
    cwd: '/work/proj',
    workspaceRoot: '/work/proj',
    read: neverRead,
  });
  assert.equal(res.refs[0]!.blocked, true);
  assert.match(res.refs[0]!.error!, /sensitive/);
});

test('@file safety: allowOutside/allowSensitive opt-ins relax the guards', () => {
  const read: FileReader = () => ({ content: 'SECRET', truncated: false, bytes: 6 });
  const res = expandFileReferences('read @.env', {
    cwd: '/work/proj',
    workspaceRoot: '/work/proj',
    allowSensitive: true,
    read,
  });
  assert.equal(res.refs[0]!.ok, true);
  assert.match(res.text, /SECRET/);
});

test('expandFileReferences: reads a real file relative to cwd (size-capped)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'as-ctx-'));
  try {
    writeFileSync(join(dir, 'hello.txt'), 'hello from disk', 'utf8');
    const { text, refs } = expandFileReferences('summarize @hello.txt', { cwd: dir });
    assert.equal(refs[0]!.ok, true);
    assert.match(text, /hello from disk/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
