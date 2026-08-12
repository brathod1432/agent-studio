"""Conversation store + JSON persistence.

Writes the exact same schema as the TypeScript engine
(``.agentstudio/conversations/<id>.json``) so both runtimes can list, resume,
and export each other's conversations.
"""

from __future__ import annotations

import json
import os
import re
import sys
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..core.paths import resolve_paths
from ..core.perms import restrict_dir, restrict_file
from ..llm.types import ChatMessage

SCHEMA_VERSION = 1
DEFAULT_TITLE = "New conversation"
_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _now_iso() -> str:
    # e.g. 2026-08-12T14:17:12.914Z  (matches the TS toISOString format)
    now = datetime.now(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


@dataclass
class Conversation:
    id: str
    title: str
    created_at: str
    updated_at: str
    messages: list[ChatMessage] = field(default_factory=list)
    provider_id: str | None = None
    model: str | None = None
    schema_version: int = SCHEMA_VERSION

    def to_json_obj(self) -> dict[str, Any]:
        return {
            "schemaVersion": SCHEMA_VERSION,
            "id": self.id,
            "title": self.title,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "providerId": self.provider_id,
            "model": self.model,
            "messages": [m.to_dict() for m in self.messages],
        }

    @staticmethod
    def from_json_obj(obj: dict[str, Any]) -> Conversation:
        return Conversation(
            id=str(obj["id"]),
            title=str(obj.get("title", DEFAULT_TITLE)),
            created_at=str(obj.get("createdAt", "")),
            updated_at=str(obj.get("updatedAt", "")),
            messages=[
                ChatMessage(role=str(m.get("role", "")), content=str(m.get("content", "")))
                for m in obj.get("messages", [])
            ],
            provider_id=obj.get("providerId"),
            model=obj.get("model"),
            schema_version=int(obj.get("schemaVersion", SCHEMA_VERSION)),
        )


@dataclass
class ConversationSummary:
    id: str
    title: str
    updated_at: str
    message_count: int


@dataclass
class SearchResult:
    id: str
    title: str
    updated_at: str
    message_count: int
    matched_in: str  # "title" | "message"
    snippet: str | None = None


# Aliases evaluated at module scope (where `list` is the builtin) so the
# ConversationStore.list method's own return annotation doesn't resolve `list`
# to the method itself (a name-shadowing quirk under future annotations).
SummaryList = list[ConversationSummary]
SearchResultList = list[SearchResult]


def derive_title(text: str) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return DEFAULT_TITLE
    return clean[:57] + "\u2026" if len(clean) > 60 else clean


def _safe_id(conv_id: str) -> str:
    if not _ID_RE.match(conv_id):
        raise ValueError(f"Invalid conversation id: {conv_id}")
    return conv_id


class ConversationStore:
    def __init__(self, data_dir: Path | None = None, ephemeral: bool = False) -> None:
        self._data_dir = data_dir or resolve_paths().data_dir
        self._ephemeral = ephemeral

    def _dir(self) -> Path:
        return self._data_dir / "conversations"

    def _path(self, conv_id: str) -> Path:
        return self._dir() / f"{_safe_id(conv_id)}.json"

    def create(
        self,
        provider_id: str | None = None,
        model: str | None = None,
        title: str | None = None,
    ) -> Conversation:
        now = _now_iso()
        return Conversation(
            id=str(uuid.uuid4()),
            title=title or DEFAULT_TITLE,
            created_at=now,
            updated_at=now,
            provider_id=provider_id,
            model=model,
        )

    def append(self, conversation: Conversation, message: ChatMessage) -> None:
        if (
            message.role == "user"
            and (conversation.title == DEFAULT_TITLE or not conversation.title)
            and not any(m.role == "user" for m in conversation.messages)
        ):
            conversation.title = derive_title(message.content)
        conversation.messages.append(message)
        conversation.updated_at = _now_iso()

    def save(self, conversation: Conversation) -> str:
        conversation.updated_at = _now_iso()
        if self._ephemeral:
            return ""
        directory = self._dir()
        directory.mkdir(parents=True, exist_ok=True)
        path = self._path(conversation.id)
        # Atomic write: temp file + rename, so a crash mid-write can't corrupt
        # an existing conversation.
        tmp = directory / f".{_safe_id(conversation.id)}.{os.getpid()}.tmp"
        tmp.write_text(json.dumps(conversation.to_json_obj(), indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)
        restrict_dir(directory)
        restrict_file(path)
        return str(path)

    def try_load(self, conv_id: str) -> Conversation | None:
        path = self._path(conv_id)
        if not path.exists():
            return None
        try:
            return Conversation.from_json_obj(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError, KeyError):
            return None

    def load(self, conv_id: str) -> Conversation:
        conv = self.try_load(conv_id)
        if conv is None:
            raise FileNotFoundError(f"Conversation not found: {conv_id}")
        return conv

    def _iter_ids(self) -> list[str]:
        d = self._dir()
        if not d.exists():
            return []
        return [p.stem for p in d.glob("*.json")]

    def list(self) -> SummaryList:
        out: list[ConversationSummary] = []
        for cid in self._iter_ids():
            conv = self.try_load(cid)
            if conv is None:
                # The file exists (from _iter_ids) but couldn't be parsed —
                # surface it rather than silently dropping it.
                print(f"Warning: skipping unreadable conversation file for id {cid} (corrupt?).", file=sys.stderr)
                continue
            out.append(ConversationSummary(conv.id, conv.title, conv.updated_at, len(conv.messages)))
        out.sort(key=lambda s: s.updated_at, reverse=True)
        return out

    def rename(self, conv_id: str, title: str) -> Conversation:
        clean = title.strip()
        if not clean:
            raise ValueError("A non-empty title is required.")
        conv = self.load(conv_id)
        conv.title = clean
        self.save(conv)
        return conv

    def delete(self, conv_id: str) -> bool:
        path = self._path(conv_id)
        if not path.exists():
            return False
        path.unlink()
        return True

    def search(self, query: str) -> SearchResultList:
        q = query.strip().lower()
        if not q:
            return []
        results: list[SearchResult] = []
        for cid in self._iter_ids():
            conv = self.try_load(cid)
            if conv is None:
                continue
            title_match = q in conv.title.lower()
            msg = next((m for m in conv.messages if q in m.content.lower()), None)
            if not title_match and not msg:
                continue
            results.append(
                SearchResult(
                    id=conv.id,
                    title=conv.title,
                    updated_at=conv.updated_at,
                    message_count=len(conv.messages),
                    matched_in="title" if title_match else "message",
                    snippet=_snippet(msg.content, q) if msg else None,
                )
            )
        results.sort(key=lambda r: r.updated_at, reverse=True)
        return results


_ELLIPSIS = "\u2026"


def _snippet(content: str, q: str, radius: int = 30) -> str:
    idx = content.lower().find(q)
    if idx == -1:
        return re.sub(r"\s+", " ", content[: radius * 2]).strip()
    start = max(0, idx - radius)
    end = min(len(content), idx + len(q) + radius)
    core = re.sub(r"\s+", " ", content[start:end]).strip()
    prefix = _ELLIPSIS if start > 0 else ""
    suffix = _ELLIPSIS if end < len(content) else ""
    return f"{prefix}{core}{suffix}"
