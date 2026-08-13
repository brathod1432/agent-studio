import assert from 'node:assert/strict';
import { test } from 'node:test';

import { envFileWarnings } from './gitHygiene.ts';

test('envFileWarnings: no file -> no warnings', () => {
  assert.deepEqual(envFileWarnings({ exists: false, tracked: false, ignored: false }), []);
});

test('envFileWarnings: tracked file is the strongest warning', () => {
  const w = envFileWarnings({ exists: true, tracked: true, ignored: true });
  assert.equal(w.length, 1);
  assert.match(w[0]!, /TRACKED by git/);
  assert.match(w[0]!, /git rm --cached/);
});

test('envFileWarnings: present but not ignored -> gitignore hint', () => {
  const w = envFileWarnings({ exists: true, tracked: false, ignored: false });
  assert.equal(w.length, 1);
  assert.match(w[0]!, /not git-ignored/);
});

test('envFileWarnings: present, ignored, untracked -> all good, no warnings', () => {
  assert.deepEqual(envFileWarnings({ exists: true, tracked: false, ignored: true }), []);
});
