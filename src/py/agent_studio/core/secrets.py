"""Secret handling — parity with the TypeScript ``secrets.ts``.

An API key value is NEVER logged, printed in full, or persisted. Secrets are
referenced by name (e.g. ``env:NVIDIA_API_KEY``) and resolved from the
environment at runtime.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


def mask_secret(value: str | None) -> str:
    """Mask a secret for display. Never returns the full value."""
    if value is None or len(value) == 0:
        return "(not set)"
    if len(value) <= 8:
        return "********"
    return f"****{value[-4:]}"


class Secret:
    """Wrapper preventing accidental leakage via str()/repr()/logging."""

    __slots__ = ("_value",)

    def __init__(self, value: str) -> None:
        self._value = value

    def reveal(self) -> str:
        """Explicitly retrieve the underlying value. Use only when needed."""
        return self._value

    @property
    def length(self) -> int:
        return len(self._value)

    def masked(self) -> str:
        return mask_secret(self._value)

    def __str__(self) -> str:
        return self.masked()

    def __repr__(self) -> str:
        return f"Secret({self.masked()})"


@dataclass(frozen=True)
class SecretRef:
    scheme: str
    name: str
    raw: str


def parse_secret_ref(ref: str | None) -> SecretRef | None:
    if not ref:
        return None
    idx = ref.find(":")
    scheme = "env" if idx == -1 else ref[:idx]
    name = ref if idx == -1 else ref[idx + 1 :]
    if scheme != "env" or not name:
        return None
    return SecretRef("env", name, ref)


def env_ref(name: str) -> str:
    return f"env:{name}"


@dataclass
class ResolvedSecret:
    present: bool
    source: str
    ref: str | None = None
    secret: Secret | None = None


def resolve_secret(ref: str | None, env: Mapping[str, str] | None = None) -> ResolvedSecret:
    env = os.environ if env is None else env
    parsed = parse_secret_ref(ref)
    if not parsed:
        return ResolvedSecret(present=False, source="unconfigured")
    value = env.get(parsed.name)
    if not value:
        return ResolvedSecret(present=False, source=f"env:{parsed.name}", ref=parsed.raw)
    return ResolvedSecret(
        present=True, source=f"env:{parsed.name}", ref=parsed.raw, secret=Secret(value)
    )


def parse_env(content: str) -> dict[str, str]:
    """Pure parser for ``.env``-style content (parity with TS ``parseEnv``)."""
    out: dict[str, str] = {}
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        eq = line.find("=")
        if eq == -1:
            continue
        key = line[:eq].strip()
        if not key:
            continue
        val = line[eq + 1 :].strip()
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        out[key] = val
    return out


def load_env_file(path: str | Path) -> dict[str, str]:
    """Load a ``.env`` file into a dict. Returns ``{}`` if missing/unreadable."""
    try:
        return parse_env(Path(path).read_text(encoding="utf-8"))
    except OSError:
        return {}


def load_environment(env: Mapping[str, str], project_root: Path) -> dict[str, str]:
    """Build the effective environment: real env overrides ``.env.local`` file
    values (matching Node's ``--env-file`` precedence)."""
    file_vars = load_env_file(project_root / ".env.local")
    merged = dict(file_vars)
    merged.update(env)
    return merged
