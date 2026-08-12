// BOM-safe, validated JSON file reading. Editors (especially on Windows) may
// save files with a UTF-8 byte-order mark, which breaks JSON.parse. We strip it
// and, on failure, throw a clear, actionable error instead of a raw stack trace
// or a silent fallback (see docs/user-experience-and-security-review.md S-4).

import { readFileSync } from 'node:fs';

/** Remove a leading UTF-8 byte-order mark (U+FEFF) if present. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Error raised when a config/JSON file exists but cannot be parsed. */
export class JsonParseError extends Error {
  readonly path: string;
  constructor(path: string, detail: string) {
    super(
      `Could not parse JSON in "${path}": ${detail}. ` +
        'Check the file for syntax errors (e.g. a trailing comma) or a byte-order mark (BOM).',
    );
    this.name = 'JsonParseError';
    this.path = path;
  }
}

/** Parse JSON text (already read), stripping a BOM. Throws {@link JsonParseError}. */
export function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(stripBom(text));
  } catch (err) {
    throw new JsonParseError(path, err instanceof Error ? err.message : String(err));
  }
}

/** Read and parse a JSON file, BOM-safe. Throws {@link JsonParseError} on bad JSON. */
export function readJsonFile(path: string): unknown {
  return parseJson(readFileSync(path, 'utf8'), path);
}
