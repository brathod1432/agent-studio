"""Prompt loading. Reuses the SAME template file as the TS engine
(``src/engine/prompts/defaults/chat-system.md``) so the system prompt matches
across runtimes. Overridable via ``AGENT_STUDIO_PROMPTS_DIR``.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Mapping

from .core.paths import resolve_paths

_VAR_RE = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")

CHAT_SYSTEM = "chat-system"

_FALLBACK_CHAT_SYSTEM = (
    "You are Agent Studio, a helpful, precise, and honest AI assistant running "
    "inside a local, user-controlled workspace application.\n\n"
    'You are currently responding through the "{{model}}" model.'
)


def render_template(template: str, context: Mapping[str, str] | None = None) -> str:
    ctx = context or {}
    return _VAR_RE.sub(lambda m: ctx.get(m.group(1), ""), template)


def _prompts_dir(env: Mapping[str, str] | None = None) -> Path:
    env = os.environ if env is None else env
    override = env.get("AGENT_STUDIO_PROMPTS_DIR")
    if override:
        return Path(override)
    return resolve_paths(env).project_root / "src" / "engine" / "prompts" / "defaults"


def load_template(name: str, env: Mapping[str, str] | None = None) -> str:
    path = _prompts_dir(env) / f"{name}.md"
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        if name == CHAT_SYSTEM:
            return _FALLBACK_CHAT_SYSTEM
        raise


def render_system_prompt(model: str, env: Mapping[str, str] | None = None) -> str:
    return render_template(load_template(CHAT_SYSTEM, env), {"model": model})
