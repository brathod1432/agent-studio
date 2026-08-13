"""Security tools. Report only the KIND of secret detected, never the value."""

from __future__ import annotations

from typing import Any

from ..core.secret_scan import describe_secret_kinds, detect_secrets
from .base import Tool, _require_str


def scan_text(args: dict[str, Any]) -> dict[str, Any]:
    text = _require_str(args, "text")
    kinds = detect_secrets(text)
    return {
        "found": len(kinds) > 0,
        "kinds": kinds,  # e.g. ["NVIDIA API key"] — never the value
        "summary": describe_secret_kinds(kinds) if kinds else "",
    }


SECRETS_SCAN_TEXT = Tool(
    name="secrets.scan_text",
    description="Detect credential/secret shapes in 'text'. Returns the KINDS found (never the values).",
    input_schema={
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
    },
    handler=scan_text,
)
