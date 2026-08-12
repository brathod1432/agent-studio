import assert from 'node:assert/strict';
import { test } from 'node:test';

import { combineInput, parseAskArgs } from './ask.ts';

test('parseAskArgs: extracts --json and joins the remaining prompt', () => {
  assert.deepEqual(parseAskArgs(['hello', 'world']), { json: false, prompt: 'hello world' });
  assert.deepEqual(parseAskArgs(['--json', 'why', 'sky', 'blue']), { json: true, prompt: 'why sky blue' });
  assert.deepEqual(parseAskArgs(['-m', 'question', 'text']), { json: false, prompt: 'question text' });
  assert.deepEqual(parseAskArgs([]), { json: false, prompt: '' });
});

test('combineInput: uses whichever of arg/stdin is present', () => {
  assert.equal(combineInput('question', ''), 'question');
  assert.equal(combineInput('', 'piped text'), 'piped text');
  assert.equal(combineInput('', ''), '');
});

test('combineInput: when both present, arg is the instruction and stdin the context', () => {
  assert.equal(combineInput('review this', 'const x = 1;\n'), 'review this\n\nconst x = 1;');
});

test('combineInput: trims trailing whitespace/newlines from piped input', () => {
  assert.equal(combineInput('', 'answer\n\n'), 'answer');
});
