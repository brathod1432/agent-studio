"""Warn if the secret file (.env.local) is exposed to git.

A very common way keys leak is committing the env file. This surfaces that in
`doctor`. The pure ``env_file_warnings`` is unit-tested; ``check_env_file`` is a
thin wrapper that gathers git facts via subprocess (no-op outside a git repo).
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def env_file_warnings(*, exists: bool, tracked: bool, ignored: bool, name: str = ".env.local") -> list[str]:
    if not exists:
        return []
    if tracked:
        return [
            f"{name} is TRACKED by git — your API key may get committed. "
            f"Fix: git rm --cached {name}  (and ensure it is in .gitignore)."
        ]
    if not ignored:
        return [f"{name} is not git-ignored — add it to .gitignore so secrets aren't committed."]
    return []


def _git(args: list[str], cwd: Path) -> int:
    try:
        return subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, timeout=5, check=False
        ).returncode
    except (OSError, subprocess.SubprocessError):
        return 1


def check_env_file(project_root: Path, name: str = ".env.local") -> list[str]:
    path = project_root / name
    if not path.exists():
        return []
    if _git(["rev-parse", "--is-inside-work-tree"], project_root) != 0:
        return []  # not a git repo — nothing to warn about
    tracked = _git(["ls-files", "--error-unmatch", name], project_root) == 0
    ignored = _git(["check-ignore", "-q", name], project_root) == 0
    return env_file_warnings(exists=True, tracked=tracked, ignored=ignored, name=name)
