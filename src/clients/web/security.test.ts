import assert from 'node:assert/strict';
import { test } from 'node:test';

import { csrfMatches, isAllowedOrigin, isLoopbackHost, SECURITY_HEADERS } from './security.ts';

test('isLoopbackHost: only loopback names pass', () => {
  assert.equal(isLoopbackHost('127.0.0.1:4173'), true);
  assert.equal(isLoopbackHost('localhost:4173'), true);
  assert.equal(isLoopbackHost('example.com'), false);
  assert.equal(isLoopbackHost(undefined), false);
});

test('isAllowedOrigin: absent origin allowed (curl); non-loopback origin rejected', () => {
  assert.equal(isAllowedOrigin(undefined), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:4173'), true);
  assert.equal(isAllowedOrigin('http://localhost:4173'), true);
  assert.equal(isAllowedOrigin('https://evil.example.com'), false);
  assert.equal(isAllowedOrigin('not a url'), false);
});

test('csrfMatches: exact token required (constant-time)', () => {
  const token = 'a'.repeat(64);
  assert.equal(csrfMatches(token, token), true);
  assert.equal(csrfMatches('b'.repeat(64), token), false);
  assert.equal(csrfMatches(undefined, token), false);
  assert.equal(csrfMatches('', token), false);
  assert.equal(csrfMatches([token], token), true); // header array form
  // Length mismatch must not throw and must be false.
  assert.equal(csrfMatches('short', token), false);
});

test('SECURITY_HEADERS: locks down content and framing', () => {
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['X-Frame-Options'], 'DENY');
  assert.match(SECURITY_HEADERS['Content-Security-Policy']!, /default-src 'none'/);
});
