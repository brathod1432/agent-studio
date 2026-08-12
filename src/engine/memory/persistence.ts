// Filesystem persistence for conversations. JSON only, human-readable, no DB,
// no dependencies. Files live under <dataDir>/conversations/<id>.json.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { logger } from '../core/logger.ts';
import { resolvePaths } from '../core/paths.ts';
import { restrictDir, restrictFile } from '../core/perms.ts';
import { CONVERSATION_SCHEMA_VERSION, type Conversation } from './types.ts';

export interface PersistenceOptions {
  /** Override the data dir (defaults to resolvePaths().dataDir). */
  dataDir?: string;
  /**
   * Ephemeral mode: nothing is written to disk. Reads still work (so existing
   * conversations remain listable), but saves are no-ops. Used by one-shot
   * `ask` and the chat `--no-save` mode.
   */
  ephemeral?: boolean;
}

export function conversationsDir(opts: PersistenceOptions = {}): string {
  const base = opts.dataDir ?? resolvePaths().dataDir;
  return join(base, 'conversations');
}

function safeId(id: string): string {
  // Conversation ids are UUIDs; reject anything that could escape the directory.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid conversation id: ${id}`);
  }
  return id;
}

export function conversationPath(id: string, opts: PersistenceOptions = {}): string {
  return join(conversationsDir(opts), `${safeId(id)}.json`);
}

export function readConversationFile(id: string, opts: PersistenceOptions = {}): Conversation | undefined {
  const path = conversationPath(id, opts);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Conversation;
  } catch {
    // The file exists but is unreadable/corrupt — surface it rather than
    // silently dropping it (and keep the file so nothing is lost).
    logger.warn(`Skipping unreadable conversation file "${path}" (corrupt JSON).`);
    return undefined;
  }
}

export function writeConversationFile(conversation: Conversation, opts: PersistenceOptions = {}): string {
  // Ephemeral mode: never touch the disk.
  if (opts.ephemeral) return '';
  const dir = conversationsDir(opts);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${safeId(conversation.id)}.json`);
  const toWrite: Conversation = { ...conversation, schemaVersion: CONVERSATION_SCHEMA_VERSION };
  // Secret instances serialize to their masked form via toJSON, but conversations
  // should never contain them in the first place. This is defense-in-depth.
  // Atomic write: write to a temp file, then rename over the target so a crash
  // mid-write can never corrupt an existing conversation.
  const tmp = join(dir, `.${safeId(conversation.id)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, JSON.stringify(toWrite, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
  restrictDir(dir);
  restrictFile(path);
  return path;
}

export function listConversationIds(opts: PersistenceOptions = {}): string[] {
  const dir = conversationsDir(opts);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length));
}

export function deleteConversationFile(id: string, opts: PersistenceOptions = {}): boolean {
  const path = conversationPath(id, opts);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}
