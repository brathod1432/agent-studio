// `privacy` and `purge` — data-lifecycle / "where is my data?" commands.
//
//   privacy                 show where data is stored + counts + guidance
//   purge --all [--yes]     delete every saved conversation (with confirmation)
//   purge --older-than N     delete conversations not updated in N days

import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ConversationStore,
  conversationsDir,
  conversationToMarkdown,
  defaultExportFilename,
  isFirstRun,
  resolvePaths,
} from '../../engine/index.ts';
import { createPrompter } from './prompt.ts';

function conversationsBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json')) total += statSync(join(dir, f)).size;
  }
  return total;
}

export function runPrivacy(): void {
  const paths = resolvePaths();
  const dir = conversationsDir();
  const store = new ConversationStore();
  const count = store.list().length;
  const kb = Math.round(conversationsBytes(dir) / 1024);

  console.log('Where your data lives (all local — nothing is uploaded except prompts you send):');
  console.log(`  Data directory:   ${paths.dataDir}`);
  console.log(`  Config directory: ${paths.configDir}`);
  console.log(`  Settings file:    ${paths.settingsFile}${isFirstRun() ? ' (not created yet)' : ''}`);
  console.log(`  Conversations:    ${count} saved (~${kb} KB) in ${dir}`);
  console.log('');
  console.log('Notes:');
  console.log('  - Conversations are stored as plaintext JSON. Treat the data dir as sensitive.');
  console.log('  - API keys live only in .env.local (referenced by name), never in settings/conversations.');
  console.log('  - Use "chat --no-save" for an ephemeral session, "--redact-secrets" to scrub secrets,');
  console.log('    and "purge" to delete stored conversations.');
}

export function runHistory(): void {
  const summaries = new ConversationStore().list();
  if (summaries.length === 0) {
    console.log('  (no saved conversations yet)');
    return;
  }
  summaries.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.title}  ·  ${s.messageCount} msgs  ·  ${s.updatedAt}`);
    console.log(`     id: ${s.id}`);
  });
}

export function runShow(argv: string[]): void {
  const id = argv[0];
  if (!id) {
    console.error('Usage: agent-studio show <id>');
    process.exitCode = 2;
    return;
  }
  const conv = new ConversationStore().tryLoad(id);
  if (!conv) {
    console.error(`No conversation with id ${id}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`# ${conv.title}`);
  if (conv.model) console.log(`(model: ${conv.model}, provider: ${conv.providerId ?? '?'})`);
  console.log('');
  for (const m of conv.messages) {
    const who = m.role === 'user' ? 'you' : m.role;
    console.log(`${who}> ${m.content}\n`);
  }
}

export function runExport(argv: string[]): void {
  const id = argv[0];
  if (!id) {
    console.error('Usage: agent-studio export <id> [path]');
    process.exitCode = 2;
    return;
  }
  const conv = new ConversationStore().tryLoad(id);
  if (!conv) {
    console.error(`No conversation with id ${id}.`);
    process.exitCode = 1;
    return;
  }
  const path = argv[1] ?? defaultExportFilename(conv);
  try {
    writeFileSync(path, conversationToMarkdown(conv), 'utf8');
    console.log(`Exported to ${path}`);
  } catch (err) {
    console.error(`Could not write "${path}": ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

export interface PurgeArgs {
  all: boolean;
  olderThanDays?: number;
  yes: boolean;
}

/** Parse `purge` argv. Pure + testable. */
export function parsePurgeArgs(argv: string[]): PurgeArgs {
  let all = false;
  let yes = false;
  let olderThanDays: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') all = true;
    else if (a === '--yes' || a === '-y') yes = true;
    else if (a === '--older-than') olderThanDays = Number(argv[++i]);
    else if (a?.startsWith('--older-than=')) olderThanDays = Number(a.slice('--older-than='.length));
  }
  if (olderThanDays != null && !Number.isFinite(olderThanDays)) olderThanDays = undefined;
  return { all, olderThanDays, yes };
}

export async function runPurge(argv: string[]): Promise<void> {
  const { all, olderThanDays, yes } = parsePurgeArgs(argv);
  if (!all && olderThanDays == null) {
    console.log('Usage: agent-studio purge --all | --older-than <days> [--yes]');
    process.exitCode = 2;
    return;
  }

  const store = new ConversationStore();
  const summaries = store.list();
  const cutoff = olderThanDays != null ? Date.now() - olderThanDays * 86_400_000 : 0;
  const targets = all ? summaries : summaries.filter((s) => Date.parse(s.updatedAt) < cutoff);

  if (targets.length === 0) {
    console.log('Nothing to purge.');
    return;
  }

  if (!yes) {
    if (!process.stdin.isTTY) {
      console.log(`Refusing to delete ${targets.length} conversation(s) without --yes in non-interactive mode.`);
      process.exitCode = 2;
      return;
    }
    const prompt = createPrompter();
    try {
      const ok = await prompt.confirm(
        `Delete ${targets.length} conversation(s)? This cannot be undone.`,
        false,
      );
      if (!ok) {
        console.log('Cancelled. Nothing was deleted.');
        return;
      }
    } finally {
      prompt.close();
    }
  }

  let deleted = 0;
  for (const s of targets) if (store.delete(s.id)) deleted += 1;
  console.log(`Deleted ${deleted} conversation(s).`);
}
