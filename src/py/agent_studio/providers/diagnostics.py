"""Format health reports and errors for the CLI (secret-safe)."""

from __future__ import annotations

from ..core.redact import scrub_string
from .errors import ProviderError
from .testing import HealthReport

_ICON = {"ok": "\u2713", "warn": "!", "error": "\u2717"}

_REMEDIATION = {
    "missing_api_key": "Add the key to .env.local (git-ignored), then re-run the check.",
    "invalid_api_key": "Double-check the API key value and that it has access to this endpoint.",
    "not_found": "Verify the base URL path (it usually ends in /v1) and the model id.",
    "rate_limit": "You are being rate limited. Wait a moment and try again.",
    "timeout": "The endpoint took too long. Check connectivity or increase the timeout.",
    "network": "Check the base URL, your network/VPN, and any firewall/proxy.",
    "server": "The provider had a server-side error. Retry shortly.",
    "invalid_config": "Review the provider configuration (base URL, kind, model).",
}


def format_health_report(report: HealthReport) -> str:
    lines = [
        f"Provider:  {report.label} ({report.provider_id}) [{report.kind}]",
        f"Endpoint:  {report.base_url or '(not set)'}",
        f"Model:     {report.model or '(not set)'}",
        f"API key:   {report.api_key_masked}"
        + (f" (from {report.api_key_env})" if report.api_key_env else ""),
        f"Overall:   {report.overall.upper()}",
        "",
        "Checks:",
    ]
    for c in report.checks:
        lines.append(f"  {_ICON.get(c.status, '?')} {c.name}: {c.message}")
    if report.latency_ms is not None:
        lines.append("")
        lines.append(f"Latency:   {int(report.latency_ms)}ms")
    return scrub_string("\n".join(lines))


def format_error(err: ProviderError) -> str:
    remedy = _REMEDIATION.get(err.kind, "Review the configuration and try again.")
    return scrub_string(f"{err.message}\nWhat to do: {remedy}")
