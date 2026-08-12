"""Resolve project/config/data directories.

Mirrors the TypeScript ``resolvePaths`` so both runtimes read and write the same
locations. All paths are overridable via environment variables.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


def find_project_root(start: Path) -> Path:
    """Walk upward from ``start`` to the nearest directory containing
    ``package.json`` (the repo root marker used by the TS side)."""
    d = start.resolve()
    for _ in range(20):
        if (d / "package.json").exists():
            return d
        if d.parent == d:
            break
        d = d.parent
    return start.resolve()


@dataclass(frozen=True)
class ResolvedPaths:
    project_root: Path
    config_dir: Path
    data_dir: Path
    settings_file: Path


def resolve_paths(env: Mapping[str, str] | None = None) -> ResolvedPaths:
    env = os.environ if env is None else env
    root = find_project_root(Path(__file__).parent)

    config_override = env.get("AGENT_STUDIO_CONFIG_DIR")
    data_override = env.get("AGENT_STUDIO_DATA_DIR")

    config_dir = Path(config_override).resolve() if config_override else root / "config"
    data_dir = Path(data_override).resolve() if data_override else root / ".agentstudio"
    return ResolvedPaths(root, config_dir, data_dir, data_dir / "settings.json")
