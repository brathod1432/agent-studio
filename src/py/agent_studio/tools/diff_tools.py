"""Unified diff tool (standard-library ``difflib``)."""

from __future__ import annotations

import difflib
from typing import Any

from .base import Tool, _require_str


def unified_diff(args: dict[str, Any]) -> dict[str, Any]:
    a = _require_str(args, "a")
    b = _require_str(args, "b")
    a_label = str(args.get("a_label", "a"))
    b_label = str(args.get("b_label", "b"))
    diff = list(
        difflib.unified_diff(
            a.splitlines(), b.splitlines(), fromfile=a_label, tofile=b_label, lineterm=""
        )
    )
    added = sum(1 for line in diff if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff if line.startswith("-") and not line.startswith("---"))
    return {"diff": "\n".join(diff), "added": added, "removed": removed, "changed": bool(added or removed)}


DIFF_UNIFIED = Tool(
    name="diff.unified",
    description="Produce a unified diff between two texts 'a' and 'b' (optional a_label/b_label).",
    input_schema={
        "type": "object",
        "properties": {
            "a": {"type": "string"},
            "b": {"type": "string"},
            "a_label": {"type": "string"},
            "b_label": {"type": "string"},
        },
        "required": ["a", "b"],
    },
    handler=unified_diff,
)
