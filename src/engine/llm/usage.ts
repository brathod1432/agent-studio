// Token usage helpers. Providers report exact usage when they can; when they
// don't (e.g. some streaming endpoints), we fall back to a rough local estimate
// so the user always sees an approximate count. Pure functions, no I/O.

import type { ChatMessage, TokenUsage } from './types.ts';

/**
 * Rough token estimate for a piece of text. Uses the common ~4-characters-per-
 * token heuristic. Deliberately approximate — only used when a provider does
 * not return exact usage.
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Estimate usage from the prompt messages and the completion text. */
export function estimateUsage(promptMessages: ChatMessage[], completion: string): TokenUsage {
  const promptText = promptMessages.map((m) => m.content).join('\n');
  const promptTokens = estimateTokensFromText(promptText);
  const completionTokens = estimateTokensFromText(completion);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

/** True when a usage object carries at least one concrete token count. */
export function hasTokenCounts(usage: TokenUsage | undefined): boolean {
  return (
    !!usage &&
    (usage.promptTokens != null || usage.completionTokens != null || usage.totalTokens != null)
  );
}

/** Sum two usage objects field-by-field (treating missing counts as 0). */
export function addUsage(a: TokenUsage, b: TokenUsage | undefined): TokenUsage {
  if (!b) return a;
  return {
    promptTokens: (a.promptTokens ?? 0) + (b.promptTokens ?? 0),
    completionTokens: (a.completionTokens ?? 0) + (b.completionTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
  };
}

/** The additive identity for {@link addUsage}. */
export function zeroUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}
