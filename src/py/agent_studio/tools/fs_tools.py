"""Filesystem/workspace summary tool.

Read-only. Stays within the given root (files resolving outside are skipped) and
caps the number of files scanned.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..context import is_sensitive_path
from .base import Tool, ToolError, _require_str


def _line_count(path: Path, max_bytes: int = 1_000_000) -> int | None:
    try:
        if path.stat().st_size > max_bytes:
            return None
        data = path.read_bytes()
        if b"\x00" in data:  # looks binary
            return None
        return data.count(b"\n") + (0 if data.endswith(b"\n") or not data else 1)
    except OSError:
        return None


def summarize_dir(args: dict[str, Any]) -> dict[str, Any]:
    root = Path(_require_str(args, "path", "root")).resolve()
    if not root.exists() or not root.is_dir():
        raise ToolError(f"Not a directory: {root}")
    max_files = int(args.get("max_files", 100))
    allow_sensitive = bool(args.get("allow_sensitive"))

    files: list[dict[str, Any]] = []
    total_bytes = 0
    truncated = False
    skipped_sensitive = 0
    for entry in sorted(root.rglob("*")):
        if not entry.is_file():
            continue
        try:
            entry.resolve().relative_to(root)  # guard against symlink escape
        except ValueError:
            continue
        # Security: don't surface credential/key files (even metadata) by default.
        if not allow_sensitive and is_sensitive_path(str(entry)):
            skipped_sensitive += 1
            continue
        if len(files) >= max_files:
            truncated = True
            break
        size = entry.stat().st_size
        total_bytes += size
        files.append(
            {
                "path": str(entry.relative_to(root)).replace("\\", "/"),
                "bytes": size,
                "lines": _line_count(entry),
            }
        )
    return {
        "root": str(root),
        "file_count": len(files),
        "total_bytes": total_bytes,
        "files": files,
        "truncated": truncated,
        "skipped_sensitive": skipped_sensitive,
    }


FS_SUMMARIZE = Tool(
    name="fs.summarize",
    description=(
        "Summarize files under a directory ('path'): relative path, size, and line count. "
        "Read-only; capped by 'max_files'."
    ),
    input_schema={
        "type": "object",
        "properties": {"path": {"type": "string"}, "max_files": {"type": "integer"}},
        "required": ["path"],
    },
    handler=summarize_dir,
)
