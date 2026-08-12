// Conversation store + session management. Wraps persistence with a small API
// for creating new sessions, resuming previous ones, appending messages, and
// listing. Auto-save is performed by the agent after each assistant reply.

import { randomUUID } from 'node:crypto';

import type { ChatMessage } from '../llm/types.ts';
import {
  deleteConversationFile,
  listConversationIds,
  readConversationFile,
  writeConversationFile,
  type PersistenceOptions,
} from './persistence.ts';
import { CONVERSATION_SCHEMA_VERSION, type Conversation, type ConversationSummary } from './types.ts';

const DEFAULT_TITLE = 'New conversation';

export interface NewConversationInput {
  providerId?: string;
  model?: string;
  title?: string;
}

/** Derive a short human-readable title from the first user message. */
export function deriveTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return DEFAULT_TITLE;
  return clean.length > 60 ? clean.slice(0, 57) + '…' : clean;
}

export class ConversationStore {
  #opts: PersistenceOptions;

  constructor(opts: PersistenceOptions = {}) {
    this.#opts = opts;
  }

  /** New Session: create a fresh conversation (not yet written to disk). */
  create(input: NewConversationInput = {}): Conversation {
    const now = new Date().toISOString();
    return {
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      id: randomUUID(),
      title: input.title ?? DEFAULT_TITLE,
      createdAt: now,
      updatedAt: now,
      providerId: input.providerId,
      model: input.model,
      messages: [],
    };
  }

  /** Resume Session: load a previously persisted conversation (throws if missing). */
  load(id: string): Conversation {
    const conv = readConversationFile(id, this.#opts);
    if (!conv) throw new Error(`Conversation not found: ${id}`);
    return conv;
  }

  tryLoad(id: string): Conversation | undefined {
    return readConversationFile(id, this.#opts);
  }

  /** Persist a conversation, stamping updatedAt. Returns the file path. */
  save(conversation: Conversation): string {
    conversation.updatedAt = new Date().toISOString();
    return writeConversationFile(conversation, this.#opts);
  }

  /** Append a message and refresh title on the first user message. */
  append(conversation: Conversation, message: ChatMessage): void {
    if (
      message.role === 'user' &&
      (conversation.title === DEFAULT_TITLE || !conversation.title) &&
      !conversation.messages.some((m) => m.role === 'user')
    ) {
      conversation.title = deriveTitle(message.content);
    }
    conversation.messages.push(message);
    conversation.updatedAt = new Date().toISOString();
  }

  list(): ConversationSummary[] {
    const summaries: ConversationSummary[] = [];
    for (const id of listConversationIds(this.#opts)) {
      const conv = readConversationFile(id, this.#opts);
      if (!conv) continue;
      summaries.push({
        id: conv.id,
        title: conv.title,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages.length,
      });
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  delete(id: string): boolean {
    return deleteConversationFile(id, this.#opts);
  }
}
