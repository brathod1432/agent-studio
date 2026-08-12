"""`@file` context expansion (parity with the TS ``fileContext``).

Reference files with ``@path`` (or ``@"quoted path"``) in a message; contents
are read (size-capped) and appended as delimited context. Missing/oversized
files are reported, never fatal. The reader is injectable for testing.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

_REF_RE = re.compile(r'(?:^|\s)@(?:"([^"]+)"|([^\s]+))')
DEFAULT_MAX_BYTES = 100 * 1024

# reader(abs_path) -> (content, truncated, size_bytes)
FileReader = Callable[[str], tuple[str, bool, int]]

# Files/paths that could leak credentials if sent to a provider.
_SENSITIVE_BASENAMES = re.compile(
    r"^(\.env(\..+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|credentials"
    r"|id_rsa|id_dsa|id_ecdsa|id_ed25519)$",
    re.IGNORECASE,
)
_SENSITIVE_EXT = re.compile(r"\.(pem|key|ppk|pfx|p12|keystore|jks)$", re.IGNORECASE)
_SENSITIVE_DIR = re.compile(r"[\\/](\.ssh|\.aws|\.gnupg|\.gcloud|\.azure|\.kube)[\\/]", re.IGNORECASE)


def is_sensitive_path(abs_path: str) -> bool:
    """Whether a resolved path looks like it may hold secrets/credentials."""
    base = Path(abs_path).name
    return bool(
        _SENSITIVE_BASENAMES.match(base)
        or _SENSITIVE_EXT.search(base)
        or _SENSITIVE_DIR.search(abs_path)
    )


def _is_inside(root: Path, target: Path) -> bool:
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


@dataclass
class FileRef:
    ref: str
    path: str
    ok: bool
    bytes: int | None = None
    truncated: bool = False
    error: str | None = None
    blocked: bool = False


@dataclass
class ExpandResult:
    text: str
    refs: list[FileRef]


def extract_file_refs(text: str) -> list[str]:
    found: list[str] = []
    for m in _REF_RE.finditer(text):
        ref = m.group(1) or m.group(2) or ""
        if ref and ref not in found:
            found.append(ref)
    return found


def _capped_reader(max_bytes: int) -> FileReader:
    def read(abs_path: str) -> tuple[str, bool, int]:
        data = Path(abs_path).read_bytes()
        truncated = len(data) > max_bytes
        return data[:max_bytes].decode("utf-8", errors="replace"), truncated, len(data)

    return read


def expand_file_references(
    text: str,
    cwd: Path | None = None,
    max_bytes: int = DEFAULT_MAX_BYTES,
    read: FileReader | None = None,
    workspace_root: Path | None = None,
    allow_outside: bool = False,
    allow_sensitive: bool = False,
) -> ExpandResult:
    cwd = cwd or Path.cwd()
    root = (workspace_root or cwd).resolve()
    reader = read or _capped_reader(max_bytes)
    references = extract_file_refs(text)
    if not references:
        return ExpandResult(text=text, refs=[])

    refs: list[FileRef] = []
    blocks: list[str] = []
    for ref in references:
        resolved = (Path(ref) if Path(ref).is_absolute() else cwd / ref).resolve()
        path = str(resolved)

        # Safety guards (default-deny). Opt-in flags relax them explicitly.
        if not allow_outside and not _is_inside(root, resolved):
            reason = "outside the workspace (use --allow-any-file to override)"
            refs.append(FileRef(ref, path, ok=False, blocked=True, error=reason))
            continue
        if not allow_sensitive and is_sensitive_path(path):
            reason = "looks sensitive (credentials/keys); refused (use --allow-any-file to override)"
            refs.append(FileRef(ref, path, ok=False, blocked=True, error=reason))
            continue

        try:
            content, truncated, size = reader(path)
            refs.append(FileRef(ref=ref, path=path, ok=True, bytes=size, truncated=truncated))
            note = f" (truncated to {max_bytes} bytes)" if truncated else ""
            blocks.append(f"File: {ref}{note}\n```\n{content}\n```")
        except OSError as err:
            refs.append(FileRef(ref=ref, path=path, ok=False, error=str(err)))

    out_text = f"{text}\n\n" + "\n\n".join(blocks) if blocks else text
    return ExpandResult(text=out_text, refs=refs)
