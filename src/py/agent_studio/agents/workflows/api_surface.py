"""API Surface pipeline: public functions/classes per module -> Markdown index.

Deterministic, read-only. Uses code.analyze (AST) via the registry.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ...context import is_sensitive_path
from ...tools.base import ToolError, ToolRegistry

MAX_FILES = 200


def _public(names: list[str]) -> list[str]:
    return [n for n in names if not n.startswith("_")]


def run(registry: ToolRegistry, target: str) -> dict[str, Any]:
    root = Path(target).resolve()
    if not root.exists():
        raise ToolError(f"Path not found: {target}")
    files = (
        [root]
        if root.is_file()
        else [p for p in sorted(root.rglob("*.py")) if p.is_file() and not is_sensitive_path(str(p))][:MAX_FILES]
    )

    modules: list[dict[str, Any]] = []
    total_public = 0
    for path in files:
        try:
            analysis = registry.call("code.analyze", {"path": str(path)})
        except ToolError:
            continue
        funcs = _public([f["name"] for f in analysis.get("functions", [])])
        classes = _public([c["name"] for c in analysis.get("classes", [])])
        if not funcs and not classes:
            continue
        rel = str(path.relative_to(root)).replace("\\", "/") if root.is_dir() else path.name
        modules.append({"module": rel, "functions": funcs, "classes": classes})
        total_public += len(funcs) + len(classes)

    sections = [
        {
            "heading": "Summary",
            "body": f"- Modules with public API: **{len(modules)}**\n- Public symbols: **{total_public}**",
        }
    ]
    for mod in modules:
        parts = []
        if mod["classes"]:
            parts.append("classes: " + ", ".join(f"`{c}`" for c in mod["classes"]))
        if mod["functions"]:
            parts.append("functions: " + ", ".join(f"`{f}`" for f in mod["functions"]))
        sections.append({"heading": mod["module"], "body": "\n".join(f"- {p}" for p in parts)})

    report = registry.call("report.markdown", {"title": "API Surface", "sections": sections})
    return {"report": report["markdown"], "modules": modules, "public_symbols": total_public}
