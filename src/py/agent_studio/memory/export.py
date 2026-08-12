"""Render a conversation to Markdown (parity with the TS exporter)."""

from __future__ import annotations

import re

from .store import Conversation

_ROLE_HEADING = {"user": "### You", "assistant": "### Assistant", "system": "### System"}


def conversation_to_markdown(conversation: Conversation) -> str:
    lines: list[str] = [f"# {conversation.title}", ""]
    if conversation.model:
        lines.append(f"- Model: {conversation.model}")
    if conversation.provider_id:
        lines.append(f"- Provider: {conversation.provider_id}")
    lines.append(f"- Created: {conversation.created_at}")
    lines.append(f"- Updated: {conversation.updated_at}")
    lines.append("")
    for m in conversation.messages:
        lines.append(_ROLE_HEADING.get(m.role, f"### {m.role}"))
        lines.append("")
        lines.append(m.content)
        lines.append("")
    return re.sub(r"\n+$", "\n", "\n".join(lines))


def default_export_filename(conversation: Conversation) -> str:
    source = conversation.title if conversation.title and conversation.title != "New conversation" else "conversation"
    slug = re.sub(r"[^a-z0-9]+", "-", source.lower()).strip("-")[:40] or "conversation"
    return f"{slug}-{conversation.id[:8]}.md"
