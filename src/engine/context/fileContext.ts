// `@file` context expansion. Lets a user reference local files in a message,
// e.g. "explain @src/foo.ts" or 'review @"my notes.md"'. Referenced files are
// read (size-capped) and appended to the message as clearly-delimited context,
// so the model sees both the instruction and the file contents.
//
// The file reader is injectable so this is fully unit-testable without touching
// the real filesystem. Missing/oversized files never throw — they are reported.

import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** Per-file read result. */
export interface FileReadResult {
  content: string;
  truncated: boolean;
  bytes: number;
}

export type FileReader = (absPath: string) => FileReadResult;

/** Outcome for a single @reference. */
export interface FileRef {
  ref: string; // the token as typed, e.g. "src/foo.ts"
  path: string; // resolved absolute path
  ok: boolean;
  bytes?: number;
  truncated?: boolean;
  error?: string;
}

export interface ExpandResult {
  /** The message with file contents appended (unchanged if there were no refs). */
  text: string;
  /** One entry per distinct @reference found. */
  refs: FileRef[];
}

export interface ExpandOptions {
  cwd?: string;
  /** Max bytes read per file (default 100 KB). */
  maxBytes?: number;
  /** Injectable reader (defaults to a size-capped filesystem reader). */
  read?: FileReader;
}

const DEFAULT_MAX_BYTES = 100 * 1024;

// Matches @token or @"quoted token", only when @ starts a word (not mid-email).
const REF_RE = /(?:^|\s)@(?:"([^"]+)"|([^\s]+))/g;

function makeCappedReader(maxBytes: number): FileReader {
  return (absPath: string): FileReadResult => {
    const size = statSync(absPath).size;
    const len = Math.min(size, maxBytes);
    const fd = openSync(absPath, 'r');
    try {
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, 0);
      return { content: buf.toString('utf8'), truncated: size > maxBytes, bytes: size };
    } finally {
      closeSync(fd);
    }
  };
}

/** Extract the distinct @references (in order) from an input string. */
export function extractFileRefs(input: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of input.matchAll(REF_RE)) {
    const ref = m[1] ?? m[2] ?? '';
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      found.push(ref);
    }
  }
  return found;
}

/**
 * Expand @file references in `input` by appending their contents. Returns the
 * original text unchanged when there are no references.
 */
export function expandFileReferences(input: string, opts: ExpandOptions = {}): ExpandResult {
  const cwd = opts.cwd ?? process.cwd();
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const read = opts.read ?? makeCappedReader(maxBytes);

  const references = extractFileRefs(input);
  if (references.length === 0) return { text: input, refs: [] };

  const refs: FileRef[] = [];
  const blocks: string[] = [];
  for (const ref of references) {
    const path = isAbsolute(ref) ? ref : resolve(cwd, ref);
    try {
      const { content, truncated, bytes } = read(path);
      refs.push({ ref, path, ok: true, bytes, truncated });
      const note = truncated ? ` (truncated to ${maxBytes} bytes)` : '';
      blocks.push(`File: ${ref}${note}\n\`\`\`\n${content}\n\`\`\``);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      refs.push({ ref, path, ok: false, error });
    }
  }

  const text = blocks.length > 0 ? `${input}\n\n${blocks.join('\n\n')}` : input;
  return { text, refs };
}
