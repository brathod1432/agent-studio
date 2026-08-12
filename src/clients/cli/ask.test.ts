import assert from 'node:assert/strict';
import { test } from 'node:test';

import { combineInput, parseAskArgs } from './ask.ts';

test('parseAskArgs: extracts --json and joins the remaining prompt', () => {
  assert.deepEqual(parseAskArgs(['hello', 'world']), {
    json: false,
    prompt: 'hello world',
    model: undefined,
    temperature: undefined,
  });
  assert.equal(parseAskArgs(['--json', 'why', 'sky', 'blue']).json, true);
  assert.equal(parseAskArgs(['--json', 'why', 'sky', 'blue']).prompt, 'why sky blue');
  assert.equal(parseAskArgs(['-m', 'question', 'text']).prompt, 'question text');
  assert.equal(parseAskArgs([]).prompt, '');
});

test('parseAskArgs: parses --model and --temperature (space and = forms)', () => {
  const a = parseAskArgs(['--model', 'meta/llama', '--temperature', '0.2', 'hi']);
  assert.equal(a.model, 'meta/llama');
  assert.equal(a.temperature, 0.2);
  assert.equal(a.prompt, 'hi');

  const b = parseAskArgs(['--model=gpt-x', '--temperature=0', 'hey']);
  assert.equal(b.model, 'gpt-x');
  assert.equal(b.temperature, 0);
  assert.equal(b.prompt, 'hey');

  // A non-numeric temperature is ignored rather than becoming NaN.
  assert.equal(parseAskArgs(['--temperature', 'nope', 'q']).temperature, undefined);
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
