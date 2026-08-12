"""Model listing + health check (parity with the TS ``testing.ts``).

The API key is resolved from the environment via the config's ``api_key_ref``;
its value is never logged or returned.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from ..config.types import ProviderConfig, RequestSettings
from ..core.http import HttpResponse, TransportError, join_url, open_http
from ..core.redact import register_secret_value
from ..core.secrets import ResolvedSecret, mask_secret, resolve_secret
from .errors import ProviderError, error_from_status, error_from_transport, missing_api_key

HttpOpen = Callable[..., HttpResponse]


@dataclass
class ModelInfo:
    id: str
    owned_by: str | None = None


@dataclass
class CheckResult:
    name: str
    status: str  # "ok" | "warn" | "error"
    message: str


@dataclass
class HealthReport:
    provider_id: str
    label: str
    kind: str
    base_url: str
    model: str
    api_key_masked: str
    api_key_env: str | None
    overall: str
    checks: list[CheckResult] = field(default_factory=list)
    models: list[ModelInfo] = field(default_factory=list)
    latency_ms: float | None = None


def _auth_headers(api_key: str | None) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def list_models(
    config: ProviderConfig,
    env: Mapping[str, str],
    request: RequestSettings,
    http_open: HttpOpen = open_http,
) -> list[ModelInfo]:
    resolved = resolve_secret(config.api_key_ref, env)
    if resolved.present and resolved.secret:
        register_secret_value(resolved.secret.reveal())
    api_key = resolved.secret.reveal() if resolved.secret else None
    url = join_url(config.base_url, "models")
    try:
        resp = http_open("GET", url, _auth_headers(api_key), None, request.timeout_ms / 1000.0)
    except TransportError as err:
        raise error_from_transport(err) from err
    if resp.status >= 400:
        raise error_from_status(resp.status, resp.header("retry-after"), resp.read_text())
    import json

    data = json.loads(resp.read_text() or "{}")
    items = data.get("data") or []
    return [
        ModelInfo(id=str(m["id"]), owned_by=m.get("owned_by"))
        for m in items
        if isinstance(m, dict) and isinstance(m.get("id"), str)
    ]


def validate_model(model_id: str, models: list[ModelInfo]) -> CheckResult:
    if not model_id:
        return CheckResult("model", "error", "No model is configured.")
    if not models:
        return CheckResult(
            "model", "warn", f'Could not verify model "{model_id}" (no model list returned).'
        )
    if any(m.id == model_id for m in models):
        return CheckResult("model", "ok", f'Model "{model_id}" is available.')
    sample = ", ".join(m.id for m in models[:5])
    suffix = ", …" if len(models) > 5 else ""
    return CheckResult(
        "model",
        "warn",
        f'Model "{model_id}" was not found in the endpoint\'s list. Available (sample): {sample}{suffix}',
    )


def health_check(
    config: ProviderConfig,
    env: Mapping[str, str],
    request: RequestSettings,
    http_open: HttpOpen = open_http,
) -> HealthReport:
    resolved = resolve_secret(config.api_key_ref, env)
    if resolved.present and resolved.secret:
        register_secret_value(resolved.secret.reveal())
    api_key_env = config.api_key_ref.replace("env:", "", 1) if config.api_key_ref else None
    checks: list[CheckResult] = []

    # config check
    if not config.base_url:
        checks.append(CheckResult("config", "error", "Base URL is not configured."))
        overall = "error"
        return _report(config, resolved, api_key_env, overall, checks, [], None)
    checks.append(CheckResult("config", "ok", f"Base URL looks valid ({config.base_url})."))

    # api_key presence
    needs_key = bool(config.api_key_ref)
    if needs_key and not (resolved.secret):
        err = missing_api_key(api_key_env)
        checks.append(CheckResult("api_key", "error", err.message))
        return _report(config, resolved, api_key_env, "error", checks, [], None)
    checks.append(
        CheckResult(
            "api_key",
            "ok" if needs_key else "warn",
            "API key is present." if needs_key else "No API key required for this provider.",
        )
    )

    # connection (via /models)
    start = time.monotonic()
    models: list[ModelInfo] = []
    try:
        models = list_models(config, env, request, http_open)
    except ProviderError as err:
        checks.append(CheckResult("connection", "error", err.message))
        checks.append(
            CheckResult("model", "warn", f'Model "{config.model or "(none)"}" not validated (no connection).')
        )
        return _report(config, resolved, api_key_env, "error", checks, [], None)
    latency_ms = (time.monotonic() - start) * 1000
    checks.append(
        CheckResult(
            "connection", "ok", f"Connected successfully in {int(latency_ms)}ms. Discovered {len(models)} model(s)."
        )
    )
    checks.append(validate_model(config.model, models))

    if any(c.status == "error" for c in checks):
        overall = "error"
    elif any(c.status == "warn" for c in checks):
        overall = "warn"
    else:
        overall = "ok"
    return _report(config, resolved, api_key_env, overall, checks, models, latency_ms)


def _report(
    config: ProviderConfig,
    resolved: ResolvedSecret,
    api_key_env: str | None,
    overall: str,
    checks: list[CheckResult],
    models: list[ModelInfo],
    latency_ms: float | None,
) -> HealthReport:
    masked = resolved.secret.masked() if resolved.secret else mask_secret(None)
    return HealthReport(
        provider_id=config.id,
        label=config.label,
        kind=config.kind,
        base_url=config.base_url,
        model=config.model,
        api_key_masked=masked,
        api_key_env=api_key_env,
        overall=overall,
        checks=checks,
        models=models,
        latency_ms=latency_ms,
    )
