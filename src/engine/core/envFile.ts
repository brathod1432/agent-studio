// Safe read/modify of a .env file (default: .env.local, which is git-ignored).
// Never logs values. Used to persist an API key the user typed during onboarding
// so it lives only in the git-ignored secret file, never in settings or source.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { restrictFile } from './perms.ts';

/**
 * Insert or update `NAME=value` in a .env file, preserving other lines and
 * comments. Creates the file if missing. Returns nothing that reveals the value.
 */
export function upsertEnvVar(path: string, name: string, value: string): void {
  const line = `${name}=${value}`;
  let content = '';
  if (existsSync(path)) content = readFileSync(path, 'utf8');

  const lines = content.length ? content.split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => new RegExp(`^\\s*${escapeRegExp(name)}\\s*=`).test(l));
  if (idx === -1) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(line);
  } else {
    lines[idx] = line;
  }
  // Normalize trailing newline.
  const out = lines.join('\n').replace(/\n*$/, '\n');
  writeFileSync(path, out, { encoding: 'utf8', mode: 0o600 });
  // Also tighten perms on an existing file (mode above only applies on create).
  restrictFile(path);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
