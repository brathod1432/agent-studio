"""Token usage estimation + context-window trimming (parity with TS)."""

from __future__ import annotations

import math

from .types import ChatMessage, TokenUsage

PER_MESSAGE_TOKENS = 4


def estimate_tokens_from_text(text: str) -> int:
    """Rough ~4-chars-per-token estimate. Only used when a provider gives none."""
    if not text:
        return 0
    return max(1, math.ceil(len(text) / 4))


def estimate_usage(prompt_messages: list[ChatMessage], completion: str) -> TokenUsage:
    prompt_text = "\n".join(m.content for m in prompt_messages)
    prompt = estimate_tokens_from_text(prompt_text)
    completion_tokens = estimate_tokens_from_text(completion)
    return TokenUsage(prompt, completion_tokens, prompt + completion_tokens)


def has_token_counts(usage: TokenUsage | None) -> bool:
    return usage is not None and (
        usage.prompt_tokens is not None
        or usage.completion_tokens is not None
        or usage.total_tokens is not None
    )


def add_usage(a: TokenUsage, b: TokenUsage | None) -> TokenUsage:
    if b is None:
        return a
    return TokenUsage(
        (a.prompt_tokens or 0) + (b.prompt_tokens or 0),
        (a.completion_tokens or 0) + (b.completion_tokens or 0),
        (a.total_tokens or 0) + (b.total_tokens or 0),
    )


def zero_usage() -> TokenUsage:
    return TokenUsage(0, 0, 0)


def _message_tokens(m: ChatMessage) -> int:
    return estimate_tokens_from_text(m.content) + PER_MESSAGE_TOKENS


def trim_messages(messages: list[ChatMessage], max_tokens: int) -> tuple[list[ChatMessage], int]:
    """Keep the newest messages fitting ``max_tokens`` (0 = unlimited). Always
    keeps the last message. Returns (kept_messages, dropped_count)."""
    if max_tokens <= 0 or not messages:
        return messages, 0
    kept_reversed: list[ChatMessage] = []
    total = 0
    for m in reversed(messages):
        t = _message_tokens(m)
        if kept_reversed and total + t > max_tokens:
            break
        kept_reversed.append(m)
        total += t
    kept = list(reversed(kept_reversed))
    return kept, len(messages) - len(kept)
