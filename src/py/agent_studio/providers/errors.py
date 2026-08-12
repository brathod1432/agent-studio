"""Normalized provider error taxonomy (parity with the TS ``errors.ts``).

Adapters translate transport/HTTP errors into these categories so the engine,
diagnostics, and CLI respond consistently. Messages are always safe to display.
"""

from __future__ import annotations

from ..core.http import TransportError

ProviderErrorKind = str  # one of the KINDS below

KINDS = (
    "missing_api_key",
    "invalid_api_key",  # 401/403
    "not_found",  # 404
    "rate_limit",  # 429
    "timeout",
    "network",
    "server",  # 5xx
    "invalid_config",
    "unknown",
)


class ProviderError(Exception):
    def __init__(
        self,
        kind: ProviderErrorKind,
        message: str,
        *,
        status: int | None = None,
        retry_after_seconds: float | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.status = status
        self.retry_after_seconds = retry_after_seconds
        self.retryable = retryable


def missing_api_key(env_name: str | None) -> ProviderError:
    where = f"Set {env_name} in your .env.local file." if env_name else "Configure an API key."
    return ProviderError("missing_api_key", f"No API key configured for this provider. {where}")


def _parse_retry_after(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        return None


def _truncate(text: str | None, n: int = 200) -> str:
    if not text:
        return ""
    text = text.strip()
    return text if len(text) <= n else text[:n] + "…"


def error_from_status(
    status: int, retry_after: str | None = None, body_hint: str | None = None
) -> ProviderError:
    hint = f" ({_truncate(body_hint)})" if body_hint else ""
    if status in (401, 403):
        return ProviderError(
            "invalid_api_key",
            f"Authentication failed (HTTP {status}). The API key was rejected.{hint}",
            status=status,
        )
    if status == 404:
        return ProviderError(
            "not_found",
            f"Endpoint or model not found (HTTP 404). Check the base URL and model id.{hint}",
            status=status,
        )
    if status == 429:
        secs = _parse_retry_after(retry_after)
        extra = f" Retry after ~{int(secs)}s." if secs is not None else ""
        return ProviderError(
            "rate_limit",
            f"Rate limited (HTTP 429).{extra}",
            status=status,
            retry_after_seconds=secs,
            retryable=True,
        )
    if status >= 500:
        return ProviderError(
            "server",
            f"Provider server error (HTTP {status}). This is usually temporary.{hint}",
            status=status,
            retryable=True,
        )
    return ProviderError("unknown", f"Unexpected response (HTTP {status}).{hint}", status=status)


def error_from_transport(err: TransportError) -> ProviderError:
    if err.kind == "timeout":
        return ProviderError(
            "timeout", "The request timed out. The endpoint may be slow or unreachable.", retryable=True
        )
    return ProviderError("network", err.message, retryable=True)
