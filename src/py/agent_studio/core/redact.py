"""Redaction — parity with the TS ``redact.ts`` essentials.

A registry of known secret literals is scrubbed from any string before it is
printed, so a resolved key can never appear in output.
"""

from __future__ import annotations

from .secrets import mask_secret

_known_secrets: set[str] = set()


def register_secret_value(value: str | None) -> None:
    """Register a raw secret so it is scrubbed anywhere it appears."""
    if value and len(value) >= 6:
        _known_secrets.add(value)


def clear_registered_secrets() -> None:
    """For tests: clear the registry."""
    _known_secrets.clear()


def scrub_string(text: str) -> str:
    """Replace any registered secret substrings with their masked form."""
    out = text
    for secret in _known_secrets:
        if secret in out:
            out = out.replace(secret, mask_secret(secret))
    return out
