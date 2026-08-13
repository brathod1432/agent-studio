"""Code analysis tools built on the standard-library ``ast`` module."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

from ..context import is_sensitive_path
from .base import Tool, ToolError


def _load_source(args: dict[str, Any]) -> str:
    source = args.get("source")
    if isinstance(source, str):
        return source
    path = args.get("path")
    if isinstance(path, str):
        # Security: refuse to read credential/key files unless explicitly allowed.
        if not bool(args.get("allow_sensitive")) and is_sensitive_path(str(Path(path).resolve())):
            raise ToolError(
                f"Refusing to read a sensitive file: {path} (pass allow_sensitive=true to override)."
            )
        try:
            return Path(path).read_text(encoding="utf-8")
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


_BRANCH_NODES = (
    ast.If,
    ast.For,
    ast.AsyncFor,
    ast.While,
    ast.ExceptHandler,
    ast.With,
    ast.AsyncWith,
    ast.IfExp,
    ast.comprehension,
    ast.BoolOp,
)


def _complexity(node: ast.AST) -> int:
    """A simple cyclomatic complexity: 1 + number of branching constructs."""
    score = 1
    for child in ast.walk(node):
        if isinstance(child, ast.BoolOp):
            score += len(child.values) - 1  # each and/or adds a path
        elif isinstance(child, _BRANCH_NODES):
            score += 1
    return score


def analyze_complexity(args: dict[str, Any]) -> dict[str, Any]:
    source = _load_source(args)
    try:
        tree = ast.parse(source)
    except SyntaxError as err:
        raise ToolError(f"Syntax error: {err.msg} (line {err.lineno})") from err

    functions: list[dict[str, Any]] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            functions.append(
                {"name": node.name, "lineno": node.lineno, "complexity": _complexity(node)}
            )
    functions.sort(key=lambda f: f["complexity"], reverse=True)
    scores = [f["complexity"] for f in functions]
    return {
        "functions": functions,
        "count": len(functions),
        "max_complexity": max(scores) if scores else 0,
        "avg_complexity": round(sum(scores) / len(scores), 2) if scores else 0,
        "hotspots": [f for f in functions if f["complexity"] >= 10],
    }


CODE_COMPLEXITY = Tool(
    name="code.complexity",
    description="Per-function cyclomatic complexity of Python source (via 'source' or 'path'); flags hotspots (>=10).",
    input_schema={
        "type": "object",
        "properties": {"source": {"type": "string"}, "path": {"type": "string"}},
    },
    handler=analyze_complexity,
)


CODE_ANALYZE = Tool(
    name="code.analyze",
    description="Parse Python source (via 'source' or 'path') and report functions, classes, imports, and counts.",
    input_schema={
        "type": "object",
        "properties": {"source": {"type": "string"}, "path": {"type": "string"}},
    },
    handler=analyze_python,
)
