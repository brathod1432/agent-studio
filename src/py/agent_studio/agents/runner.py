"""Execute an agent — either a deterministic pipeline or the model-driven
agentic tool loop — under the agent's least-privilege policy."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..llm.types import ChatResponse
from ..tools.base import ToolRegistry
from .policy import make_executor, resolve_allowed_tools
from .spec import AgentSpec
from .tool_loop import EventFn, alias_map, run_tool_loop, tool_schema
from .workflows.registry import get_pipeline

# llm(messages, tools) -> ChatResponse
LLMFn = Callable[[list[dict[str, Any]], list[dict[str, Any]]], ChatResponse]
ApproveFn = Callable[[str, dict[str, Any]], bool]

DEFAULT_SYSTEM = "You are a helpful, precise assistant. Use the provided tools when they help."


@dataclass
class AgentRunResult:
    agent_id: str
    workflow: str
    content: str
    steps: int = 0
    tool_calls_made: int = 0
    data: dict[str, Any] = field(default_factory=dict)


def run_agent(
    spec: AgentSpec,
    task: str,
    registry: ToolRegistry,
    *,
    llm: LLMFn | None = None,
    max_steps: int | None = None,
    approve: ApproveFn | None = None,
    on_event: EventFn | None = None,
) -> AgentRunResult:
    if spec.workflow == "pipeline":
        return _run_pipeline(spec, task, registry)
    return _run_agentic(
        spec, task, registry, llm=llm, max_steps=max_steps, approve=approve, on_event=on_event
    )


def _run_pipeline(spec: AgentSpec, task: str, registry: ToolRegistry) -> AgentRunResult:
    pipeline = get_pipeline(spec.pipeline or "")
    if pipeline is None:
        raise ValueError(f'{spec.id}: unknown pipeline "{spec.pipeline}".')
    result = pipeline(registry, task)
    return AgentRunResult(
        agent_id=spec.id,
        workflow="pipeline",
        content=str(result.get("report", "")),
        data={k: v for k, v in result.items() if k != "report"},
    )


def _run_agentic(
    spec: AgentSpec,
    task: str,
    registry: ToolRegistry,
    *,
    llm: LLMFn | None,
    max_steps: int | None,
    approve: ApproveFn | None,
    on_event: EventFn | None,
) -> AgentRunResult:
    if llm is None:
        raise ValueError(f"{spec.id}: an LLM is required for an agentic agent.")
    allowed = resolve_allowed_tools(spec, registry)  # validates allow-list + read-only
    tools = [tool_schema(t.descriptor()) for t in allowed]
    # Providers see sanitized (dot-free) names; map back to the real tool id.
    alias = alias_map([t.name for t in allowed])
    guarded = make_executor(spec, registry)  # refuses any non-allow-listed tool

    def executor(name: str, arguments: dict[str, Any]) -> Any:
        return guarded(alias.get(name, name), arguments)
    messages = [
        {"role": "system", "content": spec.prompt or DEFAULT_SYSTEM},
        {"role": "user", "content": task},
    ]
    # Read-only auto-approve agents need no gate; otherwise honor the caller's gate.
    gate = None if spec.policy.auto_approve else (approve or (lambda _n, _a: False))
    result = run_tool_loop(
        llm,
        messages,
        tools,
        executor,
        approve=gate,
        on_event=on_event,
        max_steps=max_steps or spec.policy.max_steps,
    )
    return AgentRunResult(
        agent_id=spec.id,
        workflow="agentic",
        content=result.content,
        steps=result.steps,
        tool_calls_made=result.tool_calls_made,
        data={"stoppedReason": result.stopped_reason},
    )
