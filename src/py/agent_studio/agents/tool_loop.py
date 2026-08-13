"""Agentic tool-calling loop.

The model is offered a set of tools; when it requests one, we (optionally ask
the user to approve, then) execute it and feed the result back, looping until the
model returns a final answer or a step budget is exhausted.

The loop is provider-agnostic (OpenAI-compatible ``tool_calls``) and fully
injectable — the LLM call, tool executor, and approval gate are all passed in —
so it is unit-testable without a network or real tools.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..llm.types import ChatResponse

_UNSAFE_NAME = re.compile(r"[^a-zA-Z0-9_-]")


def safe_tool_name(name: str) -> str:
    """Function names sent to providers must match ^[a-zA-Z0-9_-]+$ (e.g. NVIDIA
    rejects dots). Map our dotted tool ids to a provider-safe form."""
    return _UNSAFE_NAME.sub("_", name)


def alias_map(names: list[str]) -> dict[str, str]:
    """Map provider-safe names back to the real (dotted) tool names."""
    return {safe_tool_name(n): n for n in names}

# chat(messages, tools) -> ChatResponse (with .content and .tool_calls)
LLMFn = Callable[[list[dict[str, Any]], list[dict[str, Any]]], ChatResponse]
# execute(name, arguments) -> JSON-serializable result
ExecuteFn = Callable[[str, dict[str, Any]], Any]
# approve(name, arguments) -> bool
ApproveFn = Callable[[str, dict[str, Any]], bool]
# on_event(kind, detail) -> None  (kind: "call" | "result" | "denied" | "error")
EventFn = Callable[[str, str], None]


@dataclass
class ToolLoopResult:
    content: str
    steps: int
    tool_calls_made: int
    stopped_reason: str  # "final" | "max_steps"
    messages: list[dict[str, Any]] = field(default_factory=list)


def tool_schema(descriptor: dict[str, Any]) -> dict[str, Any]:
    """Convert a tool registry descriptor to an OpenAI function-tool schema. The
    function name is sanitized to the provider-safe form (see safe_tool_name)."""
    return {
        "type": "function",
        "function": {
            "name": safe_tool_name(descriptor["name"]),
            "description": descriptor.get("description", ""),
            "parameters": descriptor.get("inputSchema") or {"type": "object", "properties": {}},
        },
    }


def run_tool_loop(
    llm: LLMFn,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    execute: ExecuteFn,
    *,
    approve: ApproveFn | None = None,
    on_event: EventFn | None = None,
    max_steps: int = 6,
) -> ToolLoopResult:
    convo = list(messages)
    tool_calls_made = 0

    def emit(kind: str, detail: str) -> None:
        if on_event:
            on_event(kind, detail)

    for step in range(1, max_steps + 1):
        response = llm(convo, tools)
        if not response.tool_calls:
            return ToolLoopResult(response.content, step, tool_calls_made, "final", convo)

        # Record the assistant turn (with the tool_calls it requested).
        convo.append(
            {
                "role": "assistant",
                "content": response.content or "",
                "tool_calls": [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.name, "arguments": c.arguments},
                    }
                    for c in response.tool_calls
                ],
            }
        )

        for call in response.tool_calls:
            try:
                args = json.loads(call.arguments) if call.arguments.strip() else {}
                if not isinstance(args, dict):
                    raise ValueError("arguments must be a JSON object")
            except (json.JSONDecodeError, ValueError) as err:
                emit("error", f"{call.name}: bad arguments ({err})")
                convo.append(_tool_msg(call.id, {"error": f"invalid arguments: {err}"}))
                continue

            emit("call", f"{call.name} {json.dumps(args)}")
            if approve is not None and not approve(call.name, args):
                emit("denied", call.name)
                convo.append(_tool_msg(call.id, {"error": "the user did not approve this tool call"}))
                continue

            try:
                result = execute(call.name, args)
                tool_calls_made += 1
                emit("result", f"{call.name} -> ok")
            except Exception as err:  # noqa: BLE001 - surface as a tool error to the model
                emit("error", f"{call.name}: {err}")
                result = {"error": str(err)}
            convo.append(_tool_msg(call.id, result))

    # Budget exhausted: ask once more for a plain answer (no tools).
    final = llm(convo, [])
    return ToolLoopResult(final.content, max_steps, tool_calls_made, "max_steps", convo)


def _tool_msg(call_id: str, result: Any) -> dict[str, Any]:
    return {"role": "tool", "tool_call_id": call_id, "content": json.dumps(result)}
