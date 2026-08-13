"""TODO Scanner pipeline: find TODO/FIXME/HACK/XXX markers -> Markdown report.

Deterministic, read-only. Skips sensitive and binary files.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from ...context import is_sensitive_path
from ...tools.base import ToolError, ToolRegistry

MARKER_RE = re.compile(r"\b(TODO|FIXME|HACK|XXX)\b[:\s]?(.*)")
MAX_FILES = 1000
MAX_BYTES = 512 * 1024


def run(registry: ToolRegistry, target: str) -> dict[str, Any]:
    root = Path(target).resolve()
    if not root.exists():
        raise ToolError(f"Path not found: {target}")
    files = [root] if root.is_file() else sorted(root.rglob("*"))

    hits: list[dict[str, Any]] = []
    scanned = 0
    for path in files:
        if not path.is_file() or is_sensitive_path(str(path)):
            continue
        if scanned >= MAX_FILES:
            break
        try:
            if path.stat().st_size > MAX_BYTES:
                continue
            data = path.read_bytes()
        except OSError:
            continue
        if b"\x00" in data:
            continue
        scanned += 1
        rel = str(path.relative_to(root)).replace("\\", "/") if root.is_dir() else path.name
        for lineno, line in enumerate(data.decode("utf-8", errors="replace").splitlines(), 1):
            m = MARKER_RE.search(line)
            if m:
                hits.append({"file": rel, "line": lineno, "marker": m.group(1), "note": m.group(2).strip()})

    by_marker: dict[str, list[dict[str, Any]]] = {}
    for h in hits:
        by_marker.setdefault(h["marker"], []).append(h)

    sections = [
        {
            "heading": "Summary",
            "body": f"- Files scanned: **{scanned}**\n- Markers found: **{len(hits)}**",
        }
    ]
    for marker in sorted(by_marker):
        items = by_marker[marker]
        body = "\n".join(f"- `{h['file']}:{h['line']}` {h['note']}".rstrip() for h in items)
        sections.append({"heading": f"{marker} ({len(items)})", "body": body})
    if not hits:
        sections.append({"heading": "Result", "body": "No TODO/FIXME/HACK/XXX markers found."})

    report = registry.call("report.markdown", {"title": "TODO Scan", "sections": sections})
    return {"report": report["markdown"], "files_scanned": scanned, "markers": hits}
