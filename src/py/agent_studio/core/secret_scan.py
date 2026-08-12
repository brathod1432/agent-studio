"""Detect secrets/credentials in chat input (parity with the TS ``secretScan``).

Reports only the KIND detected, never the value, so the warning itself cannot
leak a secret.
"""

from __future__ import annotations

import re

_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("private key block", re.compile(r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----")),
    ("AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("NVIDIA API key", re.compile(r"\bnvapi-[A-Za-z0-9_-]{16,}\b")),
    ("OpenAI-style API key", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")),
    ("bearer token", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*\b", re.IGNORECASE)),
    (
        "credential assignment",
        re.compile(
            r"\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|token)\b\s*[:=]\s*\S{8,}",
            re.IGNORECASE,
        ),
    ),
]

_VOWEL_SOUND_LETTERS = "AEFHILMNORSX"


def detect_secrets(text: str) -> list[str]:
    if not text:
        return []
    kinds: list[str] = []
    for kind, pattern in _PATTERNS:
        if pattern.search(text) and kind not in kinds:
            kinds.append(kind)
    return kinds


def looks_like_secret(text: str) -> bool:
    return len(detect_secrets(text)) > 0


def redact_secrets(text: str) -> str:
    """Replace secret-looking substrings with a ``[redacted:<kind>]`` marker so a
    message can be sent/persisted without exposing the raw value."""
    out = text
    for kind, pattern in _PATTERNS:
        out = pattern.sub(f"[redacted:{kind}]", out)
    return out


def _article_for(phrase: str) -> str:
    first_word = phrase.strip().split()[0] if phrase.strip() else ""
    first = first_word[0] if first_word else ""
    if re.match(r"^[A-Z]{2,}", first_word):
        return "an" if first.upper() in _VOWEL_SOUND_LETTERS else "a"
    return "an" if first.lower() in "aeiou" else "a"


def describe_secret_kinds(kinds: list[str]) -> str:
    with_article = [f"{_article_for(k)} {k}" for k in kinds]
    if len(with_article) <= 1:
        return with_article[0] if with_article else ""
    if len(with_article) == 2:
        return f"{with_article[0]} and {with_article[1]}"
    return f"{', '.join(with_article[:-1])}, and {with_article[-1]}"
