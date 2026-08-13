"""Dependency Auditor pipeline: inventory declared dependencies across
pyproject.toml / package.json / requirements.txt and flag floating versions.

Deterministic, read-only, offline (never resolves or installs).
"""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path
from typing import Any

from ...tools.base import ToolError, ToolRegistry

# A spec is "pinned" if it constrains an exact/bounded version. We flag the rest.
_UNPINNED_PY = re.compile(r"^[A-Za-z0-9._-]+(\s*\[[^\]]*\])?\s*$")  # bare name, no version
_FLOATING_NPM = {"*", "latest", ""}


def _audit_pyproject(path: Path, deps: dict[str, list[str]], flags: list[dict[str, str]]) -> None:
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as err:
        flags.append({"file": path.name, "issue": f"could not parse: {err}"})
        return
    project = data.get("project", {})
    specs = list(project.get("dependencies", []) or [])
    for group in (project.get("optional-dependencies", {}) or {}).values():
        specs.extend(group)
    deps["pyproject.toml"] = [str(s) for s in specs]
    for spec in specs:
        s = str(spec)
        bare_name = bool(_UNPINNED_PY.match(s))
        floating = (">=" in s or ">" in s) and "==" not in s
        if bare_name or floating:
            flags.append({"file": "pyproject.toml", "issue": f"floating/unpinned: {spec}"})


def _audit_package_json(path: Path, deps: dict[str, list[str]], flags: list[dict[str, str]]) -> None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as err:
        flags.append({"file": path.name, "issue": f"could not parse: {err}"})
        return
    listed: list[str] = []
    for key in ("dependencies", "devDependencies"):
        for name, version in (data.get(key, {}) or {}).items():
            listed.append(f"{name}@{version}")
            v = str(version).strip()
            if v in _FLOATING_NPM or v.startswith(("^", "~", ">=", ">")) or "x" in v.lower():
                flags.append({"file": "package.json", "issue": f"floating: {name}@{version}"})
    deps["package.json"] = listed


def _audit_requirements(path: Path, deps: dict[str, list[str]], flags: list[dict[str, str]]) -> None:
    listed: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        listed.append(line)
        if "==" not in line and "@" not in line:
            flags.append({"file": "requirements.txt", "issue": f"unpinned: {line}"})
    deps["requirements.txt"] = listed


def run(registry: ToolRegistry, target: str) -> dict[str, Any]:
    root = Path(target).resolve()
    if not root.exists():
        raise ToolError(f"Path not found: {target}")
    if root.is_file():
        root = root.parent

    deps: dict[str, list[str]] = {}
    flags: list[dict[str, str]] = []
    if (root / "pyproject.toml").exists():
        _audit_pyproject(root / "pyproject.toml", deps, flags)
    if (root / "package.json").exists():
        _audit_package_json(root / "package.json", deps, flags)
    if (root / "requirements.txt").exists():
        _audit_requirements(root / "requirements.txt", deps, flags)

    total = sum(len(v) for v in deps.values())
    sections: list[dict[str, str]] = [
        {
            "heading": "Summary",
            "body": (
                f"- Manifests found: **{len(deps)}**\n"
                f"- Declared dependencies: **{total}**\n"
                f"- Flagged (floating/unpinned): **{len(flags)}**"
            ),
        }
    ]
    for name, items in deps.items():
        body = "\n".join(f"- `{i}`" for i in items) or "_(none)_"
        sections.append({"heading": f"{name} ({len(items)})", "body": body})
    if flags:
        body = "\n".join(f"- `{f['file']}`: {f['issue']}" for f in flags)
        sections.append({"heading": "Flagged", "body": body})

    report = registry.call("report.markdown", {"title": "Dependency Audit", "sections": sections})
    return {
        "report": report["markdown"],
        "manifests": list(deps.keys()),
        "total_dependencies": total,
        "flags": flags,
    }
