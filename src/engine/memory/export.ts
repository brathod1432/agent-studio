// Render a conversation to portable Markdown so users can drop results into
// docs, PRs, or notes. Pure and dependency-free.

import type { Conversation } from './types.ts';

const ROLE_HEADING: Record<string, string> = {
  user: '### You',
  assistant: '### Assistant',
  system: '### System',
};

/** Render a conversation as a Markdown document. */
export function conversationToMarkdown(conversation: Conversation): string {
  const lines: string[] = [];
  lines.push(`# ${conversation.title}`);
  lines.push('');
  const meta: string[] = [];
  if (conversation.model) meta.push(`- Model: ${conversation.model}`);
  if (conversation.providerId) meta.push(`- Provider: ${conversation.providerId}`);
  meta.push(`- Created: ${conversation.createdAt}`);
  meta.push(`- Updated: ${conversation.updatedAt}`);
  lines.push(...meta);
  lines.push('');

  for (const m of conversation.messages) {
    lines.push(ROLE_HEADING[m.role] ?? `### ${m.role}`);
    lines.push('');
    lines.push(m.content);
    lines.push('');
  }
  return lines.join('\n').replace(/\n+$/, '\n');
}

/** A filesystem-safe default export filename for a conversation. */
export function defaultExportFilename(conversation: Conversation): string {
  const slugSource = conversation.title && conversation.title !== 'New conversation' ? conversation.title : 'conversation';
  const slug = slugSource
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'conversation';
  return `${slug}-${conversation.id.slice(0, 8)}.md`;
}
