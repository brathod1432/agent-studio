"""JSON-RPC-over-stdio tool host (MCP-adjacent).

Lets the TypeScript engine drive the Python tool registry as a process-isolated,
least-privilege extension. Newline-delimited JSON on stdin/stdout; nothing else
is written to stdout.
"""

from __future__ import annotations
