"""Best-effort restrictive permissions for files/dirs holding data or secrets.

On POSIX this sets 0600/0700 (owner-only). On Windows chmod only toggles the
read-only bit, so this is effectively a no-op there — callers must not rely on
it as the sole protection on Windows (see the security review).
"""

from __future__ import annotations

import os
from pathlib import Path


def restrict_file(path: str | Path) -> None:
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass  # best-effort; never fail the write on a permission error


def restrict_dir(path: str | Path) -> None:
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass
