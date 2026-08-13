"""Code Reviewer pipeline: AST metrics + heuristics -> Markdown report.

Deterministic and read-only. Uses the code.analyze and report.markdown tools via
the registry (so the allow-list is honored); enumeration is done with pathlib.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ...context import is_sensitive_path
from ...tools.base import ToolError, ToolRegistry

MAX_FILES = 100


def _python_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target]
    files = [
        p
        for p in sorted(target.rglob("*.py"))
        if p.is_file() and not is_sensitive_path(str(p))
    ]
    return files[:MAX_FILES]


def _findings_for(rel: str, analysis: dict[str, Any]) -> list[str]:
    findings: list[str] = []
    counts = analysis.get("counts", {})
    lines = counts.get("lines", 0)
    if lines > 400:
        findings.append(f"large file ({lines} lines) — consider splitting")
    for fn in analysis.get("functions", []):
        if fn.get("args", 0) > 5:
            findings.append(f"function `{fn['name']}` takes {fn['args']} args — consider a params object")
    for cls in analysis.get("classes", []):
        methods = len(cls.get("methods", []))
        if methods > 15:
            findings.append(f"class `{cls['name']}` has {methods} methods — consider decomposition")
    if counts.get("imports", 0) > 20:
        findings.append(f"high import fan-out ({counts['imports']}) — module may do too much")
    if counts.get("functions", 0) == 0 and counts.get("classes", 0) == 0 and lines > 20:
        findings.append("no functions or classes — is this module just constants/glue?")
    return findings


def run(registry: ToolRegistry, target: str) -> dict[str, Any]:
    root = Path(target).resolve()
    if not root.exists():
        raise ToolError(f"Path not found: {target}")

    files = _python_files(root)
    reviewed: list[dict[str, Any]] = []
    all_findings: list[dict[str, str]] = []
    errors: list[dict[str, str]] = []
    total_lines = 0

    for path in files:
        try:
            analysis = registry.call("code.analyze", {"path": str(path)})
        except ToolError as err:
            errors.append({"file": str(path), "error": str(err)})
            continue
        rel = str(path.relative_to(root)) if root.is_dir() else path.name
        counts = analysis.get("counts", {})
        total_lines += int(counts.get("lines", 0))
        findings = _findings_for(rel, analysis)
        reviewed.append({"file": rel, "counts": counts, "findings": findings})
        for f in findings:
            all_findings.append({"file": rel, "finding": f})

    # Build a Markdown report via the report tool.
    lines_out = [
        f"- Files reviewed: **{len(reviewed)}**",
        f"- Total lines: **{total_lines}**",
        f"- Findings: **{len(all_findings)}**",
    ]
    if errors:
        lines_out.append(f"- Unreadable/parse errors: **{len(errors)}**")
    sections = [{"heading": "Summary", "body": "\n".join(lines_out)}]
    if all_findings:
        body = "\n".join(f"- `{f['file']}`: {f['finding']}" for f in all_findings)
        sections.append({"heading": "Findings", "body": body})
    else:
        sections.append({"heading": "Findings", "body": "No heuristic issues found. Nice."})
    if errors:
        body = "\n".join(f"- `{e['file']}`: {e['error']}" for e in errors)
        sections.append({"heading": "Errors", "body": body})

    report = registry.call("report.markdown", {"title": "Code Review", "sections": sections})
    return {
        "report": report["markdown"],
        "files_reviewed": len(reviewed),
        "total_lines": total_lines,
        "findings": all_findings,
        "errors": errors,
    }
