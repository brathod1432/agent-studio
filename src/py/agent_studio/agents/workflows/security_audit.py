"""Security Auditor pipeline: find exposed secrets + sensitive files -> report.

Deterministic, read-only, and secret-safe: it emits only the KIND of secret and
its location, never the value.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ...context import is_sensitive_path
from ...core.git_hygiene import check_env_file
from ...tools.base import ToolError, ToolRegistry

MAX_FILES = 500
MAX_SCAN_BYTES = 256 * 1024


def _looks_text(data: bytes) -> bool:
    return b"\x00" not in data


def run(registry: ToolRegistry, target: str) -> dict[str, Any]:
    root = Path(target).resolve()
    if not root.exists() or not root.is_dir():
        raise ToolError(f"Not a directory: {target}")

    sensitive_files: list[str] = []
    secret_hits: list[dict[str, Any]] = []
    scanned = 0

    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = str(path.relative_to(root)).replace("\\", "/")
        if is_sensitive_path(str(path)):
            # Flag its presence but NEVER read a sensitive file.
            sensitive_files.append(rel)
            continue
        if scanned >= MAX_FILES:
            break
        try:
            if path.stat().st_size > MAX_SCAN_BYTES:
                continue
            data = path.read_bytes()
        except OSError:
            continue
        if not _looks_text(data):
            continue
        scanned += 1
        result = registry.call("secrets.scan_text", {"text": data.decode("utf-8", errors="replace")})
        if result.get("found"):
            secret_hits.append({"file": rel, "kinds": result["kinds"]})

    git_warnings = check_env_file(root)

    # Severity-ordered report. Values are never included.
    sections: list[dict[str, str]] = []
    summary = [
        f"- Files scanned: **{scanned}**",
        f"- Secret hits: **{len(secret_hits)}**",
        f"- Sensitive files present: **{len(sensitive_files)}**",
        f"- Git-hygiene warnings: **{len(git_warnings)}**",
    ]
    sections.append({"heading": "Summary", "body": "\n".join(summary)})

    if secret_hits:
        body = "\n".join(f"- `{h['file']}`: {', '.join(h['kinds'])}" for h in secret_hits)
        sections.append({"heading": "CRITICAL — possible secrets in files", "body": body})
    if git_warnings:
        sections.append({"heading": "Git hygiene", "body": "\n".join(f"- {w}" for w in git_warnings)})
    if sensitive_files:
        body = "\n".join(f"- `{f}`" for f in sensitive_files)
        sections.append({"heading": "Sensitive files present (not read)", "body": body})
    if not secret_hits and not sensitive_files and not git_warnings:
        sections.append({"heading": "Result", "body": "No exposed secrets or sensitive files found."})
    sections.append(
        {
            "heading": "Remediation",
            "body": (
                "- Rotate any exposed credential immediately.\n"
                "- Move secrets into a git-ignored `.env.local` (referenced by name).\n"
                "- If a secret file is tracked: `git rm --cached <file>` and add it to `.gitignore`."
            ),
        }
    )

    report = registry.call("report.markdown", {"title": "Security Audit", "sections": sections})
    return {
        "report": report["markdown"],
        "files_scanned": scanned,
        "secret_hits": secret_hits,
        "sensitive_files": sensitive_files,
        "git_warnings": git_warnings,
    }
