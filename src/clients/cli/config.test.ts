import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveChoice } from './config.ts';

const IDS = ['nvidia/a', 'nvidia/b', 'nvidia/c'];

test('resolveChoice: maps a 1-based index to an id', () => {
  assert.equal(resolveChoice('1', IDS), 'nvidia/a');
  assert.equal(resolveChoice('3', IDS), 'nvidia/c');
});

test('resolveChoice: matches an exact id', () => {
  assert.equal(resolveChoice('nvidia/b', IDS), 'nvidia/b');
});

test('resolveChoice: returns undefined for blanks and out-of-range/unknown input', () => {
  assert.equal(resolveChoice('', IDS), undefined);
  assert.equal(resolveChoice('   ', IDS), undefined);
  assert.equal(resolveChoice('0', IDS), undefined);
  assert.equal(resolveChoice('99', IDS), undefined);
  assert.equal(resolveChoice('nope', IDS), undefined);
});
