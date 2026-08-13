import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ConversationStore } from '../../engine/index.ts';
import { parsePurgeArgs, runExport, runShow } from './data.ts';

test('parsePurgeArgs: parses --all, --older-than (space and =), and --yes', () => {
  assert.deepEqual(parsePurgeArgs(['--all', '--yes']), {
    all: true,
    olderThanDays: undefined,
    yes: true,
  });
  assert.equal(parsePurgeArgs(['--older-than', '7']).olderThanDays, 7);
  assert.equal(parsePurgeArgs(['--older-than=30']).olderThanDays, 30);
  assert.equal(parsePurgeArgs(['-y']).yes, true);
  // No target flags -> nothing selected (runPurge will print usage).
  assert.deepEqual(parsePurgeArgs([]), { all: false, olderThanDays: undefined, yes: false });
  // A non-numeric duration is ignored rather than becoming NaN.
  assert.equal(parsePurgeArgs(['--older-than', 'nope']).olderThanDays, undefined);
});

test('runExport writes a Markdown file for a stored conversation; runShow finds it', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'as-data-'));
  const prev = process.env.AGENT_STUDIO_DATA_DIR;
  process.env.AGENT_STUDIO_DATA_DIR = dataDir;
  try {
    const store = new ConversationStore();
    const conv = store.create({ providerId: 'nvidia', model: 'm' });
    store.append(conv, { role: 'user', content: 'hello there' });
    store.append(conv, { role: 'assistant', content: 'hi back' });
    store.save(conv);

    const out = join(dataDir, 'out.md');
    runExport([conv.id, out]);
    assert.ok(existsSync(out));
    assert.match(readFileSync(out, 'utf8'), /hi back/);

    // Unknown id sets a non-zero exit code.
    process.exitCode = 0;
    runShow(['does-not-exist']);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  } finally {
    if (prev === undefined) delete process.env.AGENT_STUDIO_DATA_DIR;
    else process.env.AGENT_STUDIO_DATA_DIR = prev;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
