"""Policy enforcement for agents: least-privilege tool allow-lists and a guarded
executor so an agent can only ever invoke the tools it declares.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ..tools.base import Tool, ToolError, ToolRegistry
from .spec import AgentSpec


class PolicyError(Exception):
    """Raised when an agent's declared tools violate its policy."""


def resolve_allowed_tools(spec: AgentSpec, registry: ToolRegistry) -> list[Tool]:
    """Return the Tool objects an agent may use, validating the allow-list and
    the read-only constraint. Raises PolicyError on violation."""
    allowed: list[Tool] = []
    for name in spec.tools:
        tool = registry.get(name)
        if tool is None:
            raise PolicyError(f'{spec.id}: unknown tool "{name}".')
        if spec.policy.read_only and not tool.read_only:
            raise PolicyError(f'{spec.id}: tool "{name}" is not read-only but the policy requires read-only.')
        allowed.append(tool)
    return allowed


def make_executor(spec: AgentSpec, registry: ToolRegistry) -> Callable[[str, dict[str, Any]], Any]:
    """A tool executor that only permits the agent's allow-listed tools. A call
    to any other tool (e.g. a model hallucinating a name) is refused."""
    allow = set(spec.tools)

    def execute(name: str, arguments: dict[str, Any]) -> Any:
        if name not in allow:
            raise ToolError(f'tool "{name}" is not permitted for agent "{spec.id}"')
        return registry.call(name, arguments)

    return execute
