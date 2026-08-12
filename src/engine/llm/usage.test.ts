import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatMessage } from './types.ts';
import { addUsage, estimateTokensFromText, estimateUsage, hasTokenCounts, zeroUsage } from './usage.ts';

test('estimateTokensFromText: ~4 chars per token, empty is 0', () => {
  assert.equal(estimateTokensFromText(''), 0);
  assert.equal(estimateTokensFromText('abcd'), 1);
  assert.equal(estimateTokensFromText('a'.repeat(400)), 100);
});

test('estimateUsage: sums prompt + completion estimates', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: 'a'.repeat(40) }, // ~10
    { role: 'user', content: 'b'.repeat(40) }, // ~10 (+1 for the join newline in between)
  ];
  const usage = estimateUsage(messages, 'c'.repeat(40)); // ~10
  assert.ok((usage.promptTokens ?? 0) >= 20);
  assert.equal(usage.completionTokens, 10);
  assert.equal(usage.totalTokens, (usage.promptTokens ?? 0) + 10);
});

test('hasTokenCounts: true only when a concrete count is present', () => {
  assert.equal(hasTokenCounts(undefined), false);
  assert.equal(hasTokenCounts({}), false);
  assert.equal(hasTokenCounts({ totalTokens: 0 }), true);
  assert.equal(hasTokenCounts({ promptTokens: 5 }), true);
});

test('addUsage: sums field-by-field and treats missing as 0; zeroUsage is identity', () => {
  const sum = addUsage(zeroUsage(), { promptTokens: 3, completionTokens: 4, totalTokens: 7 });
  assert.deepEqual(sum, { promptTokens: 3, completionTokens: 4, totalTokens: 7 });
  const sum2 = addUsage(sum, { totalTokens: 10 });
  assert.deepEqual(sum2, { promptTokens: 3, completionTokens: 4, totalTokens: 17 });
  assert.deepEqual(addUsage(sum, undefined), sum);
});
