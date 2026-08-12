// Secret handling. Central rule: an API key value is NEVER logged, displayed in
// full, stored in source, or persisted to settings. Secrets are referenced by
// name (e.g. "env:NVIDIA_API_KEY") and resolved from the environment at runtime.

import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';

/**
 * Mask a secret for display/diagnostics. Never returns the full value.
 * Shows only the last 4 characters (for values long enough that revealing 4
 * chars is not meaningfully identifying), otherwise fully masked.
 */
export function maskSecret(value: string | undefined | null): string {
  if (value == null || value.length === 0) return '(not set)';
  if (value.length <= 8) return '********';
  return `****${value.slice(-4)}`;
}

const util_inspect_custom = Symbol.for('nodejs.util.inspect.custom');

/**
 * Wrapper that prevents accidental leakage of a secret through logging,
 * string coercion, JSON serialization, or util.inspect. The real value is
 * only accessible via an explicit `.reveal()` call.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** Explicitly retrieve the underlying value. Use only when actually needed. */
  reveal(): string {
    return this.#value;
  }

  get length(): number {
    return this.#value.length;
  }

  masked(): string {
    return maskSecret(this.#value);
  }

  toString(): string {
    return this.masked();
  }

  toJSON(): string {
    return this.masked();
  }

  [util_inspect_custom](): string {
    return `Secret(${this.masked()})`;
  }
}

/** A parsed secret reference, e.g. "env:NVIDIA_API_KEY". */
export interface SecretRef {
  scheme: 'env';
  name: string;
  raw: string;
}

export function parseSecretRef(ref: string | undefined | null): SecretRef | undefined {
  if (!ref) return undefined;
  const idx = ref.indexOf(':');
  const scheme = idx === -1 ? 'env' : ref.slice(0, idx);
  const name = idx === -1 ? ref : ref.slice(idx + 1);
  if (scheme !== 'env') return undefined; // only env-backed refs are supported
  if (!name) return undefined;
  return { scheme: 'env', name, raw: ref };
}

/** Build the canonical reference string for an environment variable. */
export function envRef(name: string): string {
  return `env:${name}`;
}

export interface ResolvedSecret {
  present: boolean;
  /** The reference that was resolved, e.g. "env:NVIDIA_API_KEY". */
  ref?: string;
  /** Human-facing source description, safe to log. */
  source: string;
  /** Wrapped secret; only present when `present` is true. */
  secret?: Secret;
}

/**
 * Resolve a secret reference from the given environment. Returns a structure
 * that is safe to log (the actual value is wrapped in `Secret`).
 */
export function resolveSecret(
  ref: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSecret {
  const parsed = parseSecretRef(ref);
  if (!parsed) return { present: false, source: 'unconfigured' };
  const value = env[parsed.name];
  if (value == null || value.length === 0) {
    return { present: false, ref: parsed.raw, source: `env:${parsed.name}` };
  }
  return { present: true, ref: parsed.raw, source: `env:${parsed.name}`, secret: new Secret(value) };
}

/**
 * Pure parser for `.env`-style content. Never logs values. Used so secret
 * loading can be unit-tested without touching real files or `process.env`.
 */
export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Load a `.env` file into a plain object (does not mutate process.env, does not
 * log). Returns an empty object if the file is missing.
 */
export function loadEnvFile(path: string): Record<string, string> {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}
