import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePurgeArgs } from './data.ts';

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
