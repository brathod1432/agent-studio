"""Discover agents from the shared top-level ``agents/`` catalog."""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from ..core.paths import resolve_paths
from .spec import AgentSpec, AgentSpecError, load_agent


def agents_dir(env: Mapping[str, str] | None = None, agents_dir: Path | None = None) -> Path:
    if agents_dir is not None:
        return agents_dir
    env = os.environ if env is None else env
    override = env.get("AGENT_STUDIO_AGENTS_DIR")
    if override:
        return Path(override)
    return resolve_paths(env).project_root / "agents"


def load_catalog(directory: Path | None = None) -> dict[str, AgentSpec]:
    root = agents_dir(agents_dir=directory)
    if not root.exists():
        return {}
    catalog: dict[str, AgentSpec] = {}
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or not (entry / "manifest.json").exists():
            continue
        spec = load_agent(entry)
        catalog[spec.id] = spec
    return catalog


def load_agent_by_id(agent_id: str, directory: Path | None = None) -> AgentSpec:
    catalog = load_catalog(directory)
    if agent_id not in catalog:
        known = ", ".join(sorted(catalog)) or "(none)"
        raise AgentSpecError(f'Unknown agent "{agent_id}". Available: {known}')
    return catalog[agent_id]
