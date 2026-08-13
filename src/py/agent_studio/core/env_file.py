"""Safe read/modify of a .env file (default: .env.local, git-ignored).

Mirrors the TS ``upsertEnvVar``: persists an API key the user typed during
onboarding so it lives only in the git-ignored secret file — never in settings
or source. Never logs values; writes owner-only perms.
"""

from __future__ import annotations

import re
from pathlib import Path

from .perms import restrict_file


def upsert_env_var(path: str | Path, name: str, value: str) -> None:
    """Insert or update ``NAME=value``, preserving other lines/comments."""
    path = Path(path)
    content = path.read_text(encoding="utf-8") if path.exists() else ""
    lines = content.split("\n") if content else []
    # Drop a single trailing empty element from a trailing newline.
    if lines and lines[-1] == "":
        lines.pop()

    pattern = re.compile(rf"^\s*{re.escape(name)}\s*=")
    idx = next((i for i, line in enumerate(lines) if pattern.match(line)), -1)
    new_line = f"{name}={value}"
    if idx == -1:
        lines.append(new_line)
    else:
        lines[idx] = new_line

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    restrict_file(path)
