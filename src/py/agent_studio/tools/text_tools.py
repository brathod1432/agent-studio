"""Text analysis + extractive summarization (standard library only)."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from .base import Tool, _require_str

_WORD_RE = re.compile(r"[A-Za-z0-9']+")
_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]?")
_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "is",
    "are", "was", "were", "be", "it", "this", "that", "with", "as", "at", "by",
    "from", "we", "you", "i", "he", "she", "they", "our", "your",
}


def text_stats(args: dict[str, Any]) -> dict[str, Any]:
    text = _require_str(args, "text")
    words = _WORD_RE.findall(text)
    lowered = [w.lower() for w in words]
    top = Counter(w for w in lowered if w not in _STOPWORDS).most_common(int(args.get("top", 5)))
    return {
        "chars": len(text),
        "words": len(words),
        "lines": text.count("\n") + (0 if text == "" else 1),
        "unique_words": len(set(lowered)),
        "top_words": [[w, c] for w, c in top],
    }


def summarize(args: dict[str, Any]) -> dict[str, Any]:
    text = _require_str(args, "text")
    max_sentences = max(1, int(args.get("max_sentences", 3)))
    sentences = [s.strip() for s in _SENTENCE_RE.findall(text) if s.strip()]
    if len(sentences) <= max_sentences:
        return {"summary": " ".join(sentences), "sentence_count": len(sentences)}

    freq = Counter(
        w.lower() for w in _WORD_RE.findall(text) if w.lower() not in _STOPWORDS
    )
    scored: list[tuple[int, float]] = []
    for idx, sentence in enumerate(sentences):
        words = _WORD_RE.findall(sentence.lower())
        score = sum(freq[w] for w in words) / (len(words) or 1)
        scored.append((idx, score))
    top_idx = sorted(sorted(scored, key=lambda p: p[1], reverse=True)[:max_sentences], key=lambda p: p[0])
    summary = " ".join(sentences[i] for i, _ in top_idx)
    return {"summary": summary, "sentence_count": len(sentences)}


TEXT_STATS = Tool(
    name="text.stats",
    description="Report character/word/line counts, unique words, and the most frequent words for 'text'.",
    input_schema={
        "type": "object",
        "properties": {"text": {"type": "string"}, "top": {"type": "integer"}},
        "required": ["text"],
    },
    handler=text_stats,
)

TEXT_SUMMARIZE = Tool(
    name="text.summarize",
    description="Extractive summary of 'text': the highest-scoring sentences, in original order.",
    input_schema={
        "type": "object",
        "properties": {"text": {"type": "string"}, "max_sentences": {"type": "integer"}},
        "required": ["text"],
    },
    handler=summarize,
)
