// Context-window management. Long conversations send the whole transcript every
// turn, which eventually gets slow, expensive, and errors out. trimMessages
// keeps the most recent messages that fit within an (estimated) token budget,
// dropping the oldest first. It never splits a message and always keeps the
// last one (the current turn), even if it alone exceeds the budget.
//
// Trimming affects only what is SENT — the stored conversation keeps full
// history on disk.

import type { ChatMessage } from './types.ts';
import { estimateTokensFromText } from './usage.ts';

/** Rough per-message overhead (role tag, delimiters) added to content tokens. */
const PER_MESSAGE_TOKENS = 4;

export interface TrimResult {
  messages: ChatMessage[];
  /** How many leading (oldest) messages were dropped. */
  dropped: number;
}

function messageTokens(m: ChatMessage): number {
  return estimateTokensFromText(m.content) + PER_MESSAGE_TOKENS;
}

/**
 * Keep the newest messages that fit within `maxTokens` (estimated). A
 * `maxTokens <= 0` means "no limit" (returns the input unchanged).
 */
export function trimMessages(messages: ChatMessage[], maxTokens: number): TrimResult {
  if (maxTokens <= 0 || messages.length === 0) return { messages, dropped: 0 };

  const keptReversed: ChatMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = messageTokens(messages[i]!);
    // Always keep the most recent message; stop once adding another would overflow.
    if (keptReversed.length > 0 && total + t > maxTokens) break;
    keptReversed.push(messages[i]!);
    total += t;
  }
  keptReversed.reverse();
  return { messages: keptReversed, dropped: messages.length - keptReversed.length };
}
