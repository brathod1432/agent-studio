"""Test helpers: a fake HTTP transport so tests never hit the network."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

from agent_studio.core.http import TransportError


class FakeResponse:
    def __init__(
        self,
        status: int,
        body_text: str = "",
        headers: dict[str, str] | None = None,
        sse_lines: list[str] | None = None,
    ) -> None:
        self.status = status
        self._body = body_text
        self._headers = {k.lower(): v for k, v in (headers or {}).items()}
        self._sse = sse_lines
        self.closed = False

    def header(self, name: str) -> str | None:
        return self._headers.get(name.lower())

    def read_text(self) -> str:
        return self._body

    def iter_lines(self) -> Iterator[str]:
        yield from (self._sse or [])

    def close(self) -> None:
        self.closed = True


def sse_lines(deltas: list[str], model: str = "test-model", usage: dict[str, int] | None = None) -> list[str]:
    import json

    lines: list[str] = []
    for d in deltas:
        lines.append("data: " + json.dumps({"model": model, "choices": [{"delta": {"content": d}}]}))
        lines.append("")
    lines.append("data: " + json.dumps({"model": model, "choices": [{"delta": {}, "finish_reason": "stop"}]}))
    lines.append("")
    if usage is not None:
        lines.append("data: " + json.dumps({"model": model, "choices": [], "usage": usage}))
        lines.append("")
    lines.append("data: [DONE]")
    return lines


def make_http_open(
    responses: list[Any],
) -> tuple[Callable[..., FakeResponse], list[dict[str, Any]]]:
    """Return (http_open, calls). Each queued item is a FakeResponse to return,
    or an Exception/TransportError to raise, consumed one per call."""
    calls: list[dict[str, Any]] = []
    queue = list(responses)

    def http_open(method, url, headers, body=None, timeout=30.0) -> FakeResponse:
        calls.append({"method": method, "url": url, "headers": headers, "body": body})
        item = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(item, (Exception, TransportError)):
            raise item
        return item

    return http_open, calls
