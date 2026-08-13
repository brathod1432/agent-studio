"""Stdio JSON-RPC tool host.

Methods:
  - ``ping``           -> {"ok": true, "version": "..."}
  - ``tools/list``     -> {"tools": [ {name, description, inputSchema}, ... ]}
  - ``tools/call``     -> the tool result (params: {name, arguments})

Run: ``python -m agent_studio.rpc.host`` (usually spawned by the TS bridge).
"""

from __future__ import annotations

import json
import sys
from typing import Any, TextIO

from .. import __version__
from ..tools.base import ToolError, ToolRegistry
from ..tools.registry import default_registry

# JSON-RPC error codes
METHOD_NOT_FOUND = -32601
INVALID_REQUEST = -32600
TOOL_ERROR = -32000
INTERNAL_ERROR = -32603


def handle_request(request: Any, registry: ToolRegistry) -> dict[str, Any] | None:
    """Handle one parsed request object. Returns a response dict, or None for a
    notification (a request without an ``id``)."""
    if not isinstance(request, dict):
        return _error(None, INVALID_REQUEST, "Request must be a JSON object.")
    req_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}

    if not isinstance(method, str):
        return _error(req_id, INVALID_REQUEST, "Missing 'method'.") if req_id is not None else None

    try:
        if method == "ping":
            result: Any = {"ok": True, "version": __version__}
        elif method == "tools/list":
            result = {"tools": registry.list()}
        elif method == "tools/call":
            name = params.get("name")
            if not isinstance(name, str):
                return _error(req_id, INVALID_REQUEST, "tools/call requires a string 'name'.")
            result = registry.call(name, params.get("arguments") or {})
        elif method == "agents/list":
            result = {"agents": _agents_list()}
        elif method == "agents/describe":
            result = _agents_describe(str(params.get("id") or ""))
        elif method == "agents/run":
            result = _agents_run(registry, str(params.get("id") or ""), str(params.get("task") or ""))
        else:
            return _error(req_id, METHOD_NOT_FOUND, f"Unknown method: {method}")
    except ToolError as err:
        return _error(req_id, TOOL_ERROR, str(err))
    except Exception as err:  # noqa: BLE001 - never crash the host on a bad call
        return _error(req_id, INTERNAL_ERROR, str(err))

    if req_id is None:
        return None  # notification: no response
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


# -- agents (imported lazily so a bad manifest can't break tools-only hosts) --
def _agents_list() -> list[dict[str, Any]]:
    from ..agents.catalog import load_catalog

    return [spec.summary() for spec in load_catalog().values()]


def _agents_describe(agent_id: str) -> dict[str, Any]:
    from ..agents.catalog import load_agent_by_id

    spec = load_agent_by_id(agent_id)
    return {**spec.summary(), "prompt": spec.prompt}


def _agents_run(registry: ToolRegistry, agent_id: str, task: str) -> dict[str, Any]:
    import os

    from ..agents.catalog import load_agent_by_id
    from ..agents.runner import run_agent
    from ..core.paths import resolve_paths
    from ..core.secrets import load_environment
    from ..factory import create_llm_from_settings
    from ..llm.types import ChatResponse

    spec = load_agent_by_id(agent_id)
    if spec.workflow == "pipeline":
        result = run_agent(spec, task, registry)
    else:
        env = load_environment(os.environ, resolve_paths().project_root)
        resolved = create_llm_from_settings(env)
        client = resolved.client

        def llm(messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ChatResponse:
            return client.chat_with_tools(
                messages, tools, max_tokens=resolved.settings.max_output_tokens or None
            )

        result = run_agent(spec, task, registry, llm=llm)
    return {
        "agent": result.agent_id,
        "workflow": result.workflow,
        "content": result.content,
        "steps": result.steps,
        "toolCallsMade": result.tool_calls_made,
        "data": result.data,
    }


def serve(
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
    registry: ToolRegistry | None = None,
) -> int:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    registry = registry or default_registry()
    for raw in stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as err:
            response: dict[str, Any] | None = _error(None, INVALID_REQUEST, f"Invalid JSON: {err}")
        else:
            response = handle_request(request, registry)
        if response is not None:
            stdout.write(json.dumps(response) + "\n")
            stdout.flush()
    return 0


def main() -> int:
    for stream in (sys.stdout, sys.stdin):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", newline="\n")
            except (ValueError, OSError):
                pass
    return serve()


if __name__ == "__main__":
    sys.exit(main())
