import assert from 'node:assert/strict';
import { test } from 'node:test';

import { trimMessages } from './contextWindow.ts';
import type { ChatMessage } from './types.ts';

function msgs(n: number, len = 40): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${i}:` + 'x'.repeat(len),
  }));
}

test('trimMessages: maxTokens <= 0 means unlimited (returns input unchanged)', () => {
  const m = msgs(5);
  const r = trimMessages(m, 0);
  assert.equal(r.messages.length, 5);
  assert.equal(r.dropped, 0);
});

test('trimMessages: keeps only the newest messages that fit, dropping oldest', () => {
  // Each ~40-char message ≈ ceil(42/4)=11 + 4 overhead ≈ 15 tokens.
  const m = msgs(5);
  const r = trimMessages(m, 32); // fits ~2 recent messages
  assert.ok(r.messages.length >= 1 && r.messages.length < 5);
  assert.equal(r.dropped, 5 - r.messages.length);
  // The kept messages are the most recent, in order.
  assert.equal(r.messages[r.messages.length - 1]!.content, m[m.length - 1]!.content);
});

test('trimMessages: always keeps the last message even if it alone exceeds the budget', () => {
  const m: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(4000) }];
  const r = trimMessages(m, 5);
  assert.equal(r.messages.length, 1);
  assert.equal(r.dropped, 0);
});

test('trimMessages: keeps everything when the budget is generous', () => {
  const m = msgs(4);
  const r = trimMessages(m, 100000);
  assert.equal(r.messages.length, 4);
  assert.equal(r.dropped, 0);
});
