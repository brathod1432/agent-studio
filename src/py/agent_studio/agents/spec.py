"""Agent specification + single-agent loader (reads a directory in the shared
top-level ``agents/`` catalog: manifest.json + prompt file)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AgentPolicy:
    read_only: bool = True
    auto_approve: bool = True
    max_steps: int = 6

    @staticmethod
    def from_raw(raw: dict[str, Any] | None) -> AgentPolicy:
        raw = raw or {}
        return AgentPolicy(
            read_only=bool(raw.get("readOnly", True)),
            auto_approve=bool(raw.get("autoApprove", True)),
            max_steps=int(raw.get("maxSteps", 6)),
        )


@dataclass(frozen=True)
class AgentSpec:
    id: str
    name: str
    description: str
    workflow: str  # "pipeline" | "agentic"
    pipeline: str | None
    tools: tuple[str, ...]
    policy: AgentPolicy
    prompt: str
    directory: Path

    def summary(self) -> dict[str, object]:
        """Machine-readable summary (no prompt body) for list/describe."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "workflow": self.workflow,
            "pipeline": self.pipeline,
            "tools": list(self.tools),
            "policy": {
                "readOnly": self.policy.read_only,
                "autoApprove": self.policy.auto_approve,
                "maxSteps": self.policy.max_steps,
            },
        }


class AgentSpecError(Exception):
    """Raised when an agent manifest is missing or malformed."""


def load_agent(agent_dir: Path) -> AgentSpec:
    manifest_path = agent_dir / "manifest.json"
    try:
        raw: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    except OSError as err:
        raise AgentSpecError(f"Cannot read {manifest_path}: {err}") from err
    except json.JSONDecodeError as err:
        raise AgentSpecError(f"Invalid manifest JSON in {manifest_path}: {err}") from err

    agent_id = str(raw.get("id") or agent_dir.name)
    workflow = str(raw.get("workflow", "agentic"))
    if workflow not in ("pipeline", "agentic"):
        raise AgentSpecError(f'{agent_id}: workflow must be "pipeline" or "agentic".')

    prompt_file = str(raw.get("promptFile", "prompt.md"))
    prompt_path = agent_dir / prompt_file
    prompt = prompt_path.read_text(encoding="utf-8").strip() if prompt_path.exists() else ""

    return AgentSpec(
        id=agent_id,
        name=str(raw.get("name", agent_id)),
        description=str(raw.get("description", "")),
        workflow=workflow,
        pipeline=str(raw["pipeline"]) if raw.get("pipeline") else None,
        tools=tuple(str(t) for t in raw.get("tools", [])),
        policy=AgentPolicy.from_raw(raw.get("policy")),
        prompt=prompt,
        directory=agent_dir,
    )
