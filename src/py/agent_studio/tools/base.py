"""Tool abstraction + registry.

A tool has a name, a human description, a lightweight input schema (for
discovery), and a handler that maps a JSON-serializable ``dict`` of arguments to
a JSON-serializable result. Handlers raise :class:`ToolError` for bad input.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

ToolHandler = Callable[[dict[str, Any]], Any]


class ToolError(Exception):
    """Raised for invalid arguments or a tool-level failure (safe to display)."""


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: ToolHandler

    def descriptor(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "inputSchema": self.input_schema}


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"Duplicate tool name: {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return sorted(self._tools)

    def list(self) -> list[dict[str, Any]]:
        return [self._tools[n].descriptor() for n in self.names()]

    def call(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        tool = self._tools.get(name)
        if tool is None:
            raise ToolError(f'Unknown tool: "{name}"')
        return tool.handler(arguments or {})


def _require_str(args: dict[str, Any], *keys: str) -> str:
    """Return the first present string among ``keys`` (raise if none/blank)."""
    for key in keys:
        value = args.get(key)
        if isinstance(value, str) and value != "":
            return value
    raise ToolError(f"Missing required argument: {' or '.join(keys)}")
