"""Minimal HTTP transport built on the standard library (no third-party deps).

Non-2xx responses are returned (not raised) so the provider layer can map them
to the normalized error taxonomy. Only genuine connect/timeout failures raise
``TransportError``.
"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from typing import Any, Iterator, Mapping


def join_url(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


class TransportError(Exception):
    """A connection-level failure (DNS/refused/reset) or a timeout."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind  # "timeout" | "network"
        self.message = message


class HttpResponse:
    """Wraps a urllib response (success or HTTPError) with a uniform surface."""

    def __init__(self, raw: Any) -> None:
        self._raw = raw
        self.status: int = int(getattr(raw, "status", None) or raw.getcode())

    def header(self, name: str) -> str | None:
        return self._raw.headers.get(name)

    def read_text(self) -> str:
        try:
            return self._raw.read().decode("utf-8", errors="replace")
        finally:
            self.close()

    def iter_lines(self) -> Iterator[str]:
        """Yield decoded lines (without trailing newline). For SSE bodies."""
        try:
            for raw_line in self._raw:
                yield raw_line.decode("utf-8", errors="replace").rstrip("\n")
        finally:
            self.close()

    def close(self) -> None:
        try:
            self._raw.close()
        except Exception:  # noqa: BLE001 - closing must never raise
            pass


def open_http(
    method: str,
    url: str,
    headers: Mapping[str, str],
    body: Any | None = None,
    timeout: float = 30.0,
) -> HttpResponse:
    """Perform a request. Returns an :class:`HttpResponse` for any HTTP status;
    raises :class:`TransportError` for connect/timeout failures."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        return HttpResponse(urllib.request.urlopen(req, timeout=timeout))  # noqa: S310
    except urllib.error.HTTPError as err:  # 4xx/5xx are valid responses here
        return HttpResponse(err)
    except socket.timeout as err:
        raise TransportError("timeout", "The request timed out.") from err
    except urllib.error.URLError as err:
        reason = err.reason
        if isinstance(reason, socket.timeout) or isinstance(reason, TimeoutError):
            raise TransportError("timeout", "The request timed out.") from err
        raise TransportError("network", f"Could not reach the endpoint: {reason}") from err
    except (TimeoutError, ConnectionError) as err:
        raise TransportError("network", f"Could not reach the endpoint: {err}") from err
