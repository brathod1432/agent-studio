// Redaction utilities. Everything that might be logged or shown in diagnostics
// passes through here so secret values and sensitive keys are masked.

import { maskSecret, Secret } from './secrets.ts';

/** Keys whose values are always masked, regardless of content. */
const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|authorization|access[-_]?token|secret|password|passwd|bearer|credential|token)/i;

/** A registry of known secret literal values to scrub from arbitrary output. */
const knownSecrets = new Set<string>();

/** Register a raw secret value so it is scrubbed anywhere it appears. */
export function registerSecretValue(value: string | undefined | null): void {
  if (value && value.length >= 6) knownSecrets.add(value);
}

/** For tests: clear the registry. */
export function clearRegisteredSecrets(): void {
  knownSecrets.clear();
}

/** Scrub any registered secret substrings from a string. */
export function scrubString(input: string): string {
  let out = input;
  for (const s of knownSecrets) {
    if (out.includes(s)) out = out.split(s).join(maskSecret(s));
  }
  return out;
}

/**
 * Deep-redact a value so it is safe to log: masks sensitive keys, scrubs known
 * secret substrings, and renders Secret instances as their masked form.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (value instanceof Secret) return value.masked();
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[Function]';

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((v) => redact(v, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? maskValue(v) : redact(v, seen);
    }
    return out;
  }
  return String(value);
}

function maskValue(v: unknown): string {
  if (v instanceof Secret) return v.masked();
  if (typeof v === 'string') return maskSecret(v);
  if (v == null) return '(not set)';
  return '********';
}
