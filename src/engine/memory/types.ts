// Conversation memory types. Conversations hold only plain-text chat messages
// and non-secret metadata; API keys never appear here.

import type { ChatMessage } from '../llm/types.ts';

export const CONVERSATION_SCHEMA_VERSION = 1;

export interface Conversation {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** Non-secret provider metadata for context/debugging. */
  providerId?: string;
  model?: string;
  messages: ChatMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationSearchResult extends ConversationSummary {
  /** Where the query matched. */
  matchedIn: 'title' | 'message';
  /** A short excerpt around the first message match (absent for title-only matches). */
  snippet?: string;
}
