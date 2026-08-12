"""Code analysis tools built on the standard-library ``ast`` module."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

from .base import Tool, ToolError, _require_str


def _load_source(args: dict[str, Any]) -> str:
    if isinstance(args.get("source"), str):
        return args["source"]
    if isinstance(args.get("path"), str):
        try:
            return Path(args["path"]).read_text(encoding="utf-8")
        except OSError as err:
            raise ToolError(f"Could not read file: {err}") from err
    raise ToolError("Provide 'source' (code) or 'path' (file).")


def analyze_python(args: dict[str, Any]) -> dict[str, Any]:
    source = _load_source(args)
    try:
        tree = ast.parse(source)
    except SyntaxError as err:
        raise ToolError(f"Syntax error: {err.msg} (line {err.lineno})") from err

    functions: list[dict[str, Any]] = []
    classes: list[dict[str, Any]] = []
    imports: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, (ast.Import,)):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            imports.extend(f"{module}.{alias.name}" if module else alias.name for alias in node.names)

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append({"name": node.name, "lineno": node.lineno, "args": len(node.args.args)})
        elif isinstance(node, ast.ClassDef):
            methods = [
                b.name for b in node.body if isinstance(b, (ast.FunctionDef, ast.AsyncFunctionDef))
            ]
            classes.append({"name": node.name, "lineno": node.lineno, "methods": methods})

    return {
        "functions": functions,
        "classes": classes,
        "imports": sorted(set(imports)),
        "counts": {
            "functions": len(functions),
            "classes": len(classes),
            "imports": len(set(imports)),
            "lines": source.count("\n") + (0 if source.endswith("\n") or source == "" else 1),
        },
    }


CODE_ANALYZE = Tool(
    name="code.analyze",
    description="Parse Python source (via 'source' or 'path') and report functions, classes, imports, and counts.",
    input_schema={
        "type": "object",
        "properties": {"source": {"type": "string"}, "path": {"type": "string"}},
    },
    handler=analyze_python,
)
