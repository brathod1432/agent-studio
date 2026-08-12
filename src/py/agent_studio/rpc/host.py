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
from typing import Any

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


def serve(stdin=None, stdout=None, registry: ToolRegistry | None = None) -> int:
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
