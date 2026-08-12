// Lightweight detector for secrets/credentials pasted into chat input. Used to
// WARN a user before their message (and any secret in it) is sent to a provider
// and persisted to disk in plaintext (see UX/security review S-1).
//
// It reports only the KIND of thing detected — never the matched value — so the
// warning itself can't leak the secret.

interface SecretPattern {
  kind: string;
  re: RegExp;
}

// Ordered, specific-first. Patterns are intentionally conservative to limit
// false positives; a match only triggers a warning, never a hard block.
const PATTERNS: SecretPattern[] = [
  { kind: 'private key block', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { kind: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { kind: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'NVIDIA API key', re: /\bnvapi-[A-Za-z0-9_-]{16,}\b/ },
  { kind: 'OpenAI-style API key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { kind: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*\b/i },
  {
    kind: 'credential assignment',
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|token)\b\s*[:=]\s*\S{8,}/i,
  },
];

/**
 * Return the distinct kinds of secret-looking content found in `text`.
 * Empty array means nothing suspicious was detected.
 */
export function detectSecrets(text: string): string[] {
  if (!text) return [];
  const kinds = new Set<string>();
  for (const p of PATTERNS) {
    if (p.re.test(text)) kinds.add(p.kind);
  }
  return [...kinds];
}

/** Convenience boolean wrapper around {@link detectSecrets}. */
export function looksLikeSecret(text: string): boolean {
  return detectSecrets(text).length > 0;
}

// Consonant letters whose spoken name begins with a vowel sound (so an
// all-caps acronym starting with one takes "an", e.g. "an NVIDIA key").
const VOWEL_SOUND_LETTERS = 'AEFHILMNORSX';

function articleFor(phrase: string): 'a' | 'an' {
  const firstWord = phrase.trimStart().split(/\s+/)[0] ?? '';
  const first = firstWord[0] ?? '';
  if (/^[A-Z]{2,}/.test(firstWord)) {
    return VOWEL_SOUND_LETTERS.includes(first.toUpperCase()) ? 'an' : 'a';
  }
  return /[aeiou]/i.test(first) ? 'an' : 'a';
}

/** Human-readable summary of detected kinds, e.g. "an NVIDIA API key and a bearer token". */
export function describeSecretKinds(kinds: string[]): string {
  const withArticle = kinds.map((k) => `${articleFor(k)} ${k}`);
  if (withArticle.length <= 1) return withArticle[0] ?? '';
  if (withArticle.length === 2) return `${withArticle[0]} and ${withArticle[1]}`;
  return `${withArticle.slice(0, -1).join(', ')}, and ${withArticle[withArticle.length - 1]}`;
}
