// Pure security helpers for the loopback onboarding server, split out so they
// can be unit-tested without starting an HTTP server. See the UX/security
// review (S-3): the local server needs CSRF protection, an Origin allowlist,
// and restrictive response headers.

import { timingSafeEqual } from 'node:crypto';

/** Restrictive headers applied to every response. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** The Host header (sans port) must be a loopback name. */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  const host = (hostHeader ?? '').split(':')[0];
  return LOOPBACK.has(host);
}

/**
 * Reject cross-origin requests. Browsers always send Origin on cross-origin
 * POST, so an absent Origin means a non-browser client (curl) which is fine.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Constant-time comparison of a request's CSRF token against the expected one. */
export function csrfMatches(header: string | string[] | undefined, expected: string): boolean {
  const token = Array.isArray(header) ? header[0] : header;
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
