"""Load the provider catalog, defaults, and user settings.

BOM-safe and validated (parity with the TS S-4 hardening): a malformed settings
file warns and falls back to defaults rather than crashing or silently
reverting; a malformed provider catalog raises a clear, actionable error.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ..core.paths import resolve_paths
from .types import (
    AppSettings,
    DefaultConfig,
    ProviderCatalog,
    ProviderConfig,
    ProviderPreset,
    RequestSettings,
)

VALID_KINDS = ("openai-compatible", "anthropic")


class JsonParseError(Exception):
    def __init__(self, path: Path, detail: str) -> None:
        super().__init__(
            f'Could not parse JSON in "{path}": {detail}. '
            "Check the file for syntax errors (e.g. a trailing comma) or a byte-order mark (BOM)."
        )
        self.path = path


def _strip_bom(text: str) -> str:
    return text[1:] if text and text[0] == "\ufeff" else text


def read_json_file(path: Path) -> Any:
    text = _strip_bom(path.read_text(encoding="utf-8"))
    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        raise JsonParseError(path, str(err)) from err


def _request_from(raw: Mapping[str, Any] | None) -> RequestSettings:
    raw = raw or {}
    return RequestSettings(
        timeout_ms=int(raw.get("timeoutMs", 30000)),
        max_retries=int(raw.get("maxRetries", 2)),
        retry_base_delay_ms=int(raw.get("retryBaseDelayMs", 500)),
    )


def _coerce_preset(preset_id: str, raw: Mapping[str, Any]) -> ProviderPreset:
    kind = str(raw.get("kind", ""))
    if kind not in VALID_KINDS:
        raise ValueError(f'Provider "{preset_id}" has invalid kind "{raw.get("kind")}"')
    return ProviderPreset(
        id=str(raw.get("id", preset_id)),
        label=str(raw.get("label", preset_id)),
        kind=kind,
        base_url=str(raw.get("baseUrl", "")),
        api_key_env=str(raw.get("apiKeyEnv", "")),
        requires_api_key=bool(raw.get("requiresApiKey", False)),
        default_model=str(raw.get("defaultModel", "")),
        docs_url=str(raw["docsUrl"]) if raw.get("docsUrl") else None,
        notes=str(raw["notes"]) if raw.get("notes") else None,
    )


def load_catalog(config_dir: Path | None = None) -> ProviderCatalog:
    directory = config_dir or resolve_paths().config_dir
    raw = read_json_file(directory / "providers.json")
    providers_raw = (raw or {}).get("providers", {})
    providers = {pid: _coerce_preset(pid, p) for pid, p in providers_raw.items()}
    if not providers:
        raise ValueError(f"No providers found in {directory / 'providers.json'}")
    return ProviderCatalog(providers=providers)


def load_default_config(config_dir: Path | None = None) -> DefaultConfig:
    directory = config_dir or resolve_paths().config_dir
    raw = read_json_file(directory / "default.json")
    return DefaultConfig(
        active_provider=str(raw["activeProvider"]) if raw.get("activeProvider") else None,
        default_model=str(raw.get("defaultModel", "")),
        request=_request_from(raw.get("request")),
        max_context_tokens=int(raw.get("maxContextTokens", 0)),
    )


def provider_config_from_preset(
    preset: ProviderPreset, model: str | None = None
) -> ProviderConfig:
    return ProviderConfig(
        id=preset.id,
        label=preset.label,
        kind=preset.kind,
        base_url=preset.base_url,
        model=model or preset.default_model,
        api_key_ref=f"env:{preset.api_key_env}" if preset.api_key_env else None,
    )


def _provider_config_from_raw(raw: Mapping[str, Any]) -> ProviderConfig:
    return ProviderConfig(
        id=str(raw.get("id", "")),
        label=str(raw.get("label", raw.get("id", ""))),
        kind=str(raw.get("kind", "openai-compatible")),
        base_url=str(raw.get("baseUrl", "")),
        model=str(raw.get("model", "")),
        api_key_ref=str(raw["apiKeyRef"]) if raw.get("apiKeyRef") else None,
    )


def _read_settings_file(path: Path, warn: bool) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        parsed = json.loads(_strip_bom(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError) as err:
        if warn:
            print(
                f"Warning: ignoring unreadable settings file; using defaults instead. {err}",
                file=sys.stderr,
            )
        return None
    if not isinstance(parsed, dict):
        if warn:
            print(f'Warning: settings file "{path}" is not a JSON object; using defaults.', file=sys.stderr)
        return None
    return parsed


def load_settings(
    config_dir: Path | None = None,
    data_dir: Path | None = None,
    warn: bool = True,
) -> AppSettings:
    paths = resolve_paths()
    cfg = config_dir or paths.config_dir
    settings_file = (data_dir / "settings.json") if data_dir else paths.settings_file

    defaults = load_default_config(cfg)
    catalog = load_catalog(cfg)
    saved = _read_settings_file(settings_file, warn) or {}

    active = saved.get("activeProvider") or defaults.active_provider
    providers: dict[str, ProviderConfig] = {}
    for pid, raw in (saved.get("providers") or {}).items():
        providers[pid] = _provider_config_from_raw(raw)

    if active and active not in providers and active in catalog.providers:
        providers[active] = provider_config_from_preset(
            catalog.providers[active], defaults.default_model or catalog.providers[active].default_model
        )

    request = defaults.request
    if isinstance(saved.get("request"), dict):
        request = _request_from({**_request_to_raw(defaults.request), **saved["request"]})

    return AppSettings(
        active_provider=active,
        default_model=saved.get("defaultModel") or defaults.default_model,
        providers=providers,
        request=request,
        max_context_tokens=int(saved.get("maxContextTokens", defaults.max_context_tokens)),
    )


def _request_to_raw(req: RequestSettings) -> dict[str, Any]:
    return {
        "timeoutMs": req.timeout_ms,
        "maxRetries": req.max_retries,
        "retryBaseDelayMs": req.retry_base_delay_ms,
    }


def _provider_to_raw(cfg: ProviderConfig) -> dict[str, Any]:
    # Only non-secret fields are persisted (apiKeyRef, never a key value).
    return {
        "id": cfg.id,
        "label": cfg.label,
        "kind": cfg.kind,
        "baseUrl": cfg.base_url,
        "apiKeyRef": cfg.api_key_ref,
        "model": cfg.model,
    }


def settings_to_raw(settings: AppSettings) -> dict[str, Any]:
    return {
        "activeProvider": settings.active_provider,
        "defaultModel": settings.default_model,
        "providers": {pid: _provider_to_raw(p) for pid, p in settings.providers.items()},
        "request": _request_to_raw(settings.request),
        "maxContextTokens": settings.max_context_tokens,
    }


def save_settings(settings: AppSettings, data_dir: Path | None = None) -> Path:
    settings_file = (data_dir / "settings.json") if data_dir else resolve_paths().settings_file
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(
        json.dumps(settings_to_raw(settings), indent=2) + "\n", encoding="utf-8"
    )
    return settings_file


def set_active_model(model: str, data_dir: Path | None = None, config_dir: Path | None = None) -> AppSettings:
    clean = model.strip()
    if not clean:
        raise ValueError("A model id is required.")
    catalog = load_catalog(config_dir)
    settings = load_settings(config_dir=config_dir, data_dir=data_dir, warn=False)
    pid = settings.active_provider
    if not pid:
        raise ValueError("No active provider is configured. Run onboarding first.")
    if pid in settings.providers:
        settings.providers[pid].model = clean
    elif pid in catalog.providers:
        settings.providers[pid] = provider_config_from_preset(catalog.providers[pid], clean)
    else:
        raise ValueError(f'Unknown provider "{pid}".')
    save_settings(settings, data_dir)
    return settings


def set_active_provider(
    provider_id: str,
    model: str | None = None,
    data_dir: Path | None = None,
    config_dir: Path | None = None,
) -> AppSettings:
    catalog = load_catalog(config_dir)
    settings = load_settings(config_dir=config_dir, data_dir=data_dir, warn=False)
    existing = settings.providers.get(provider_id)
    preset = catalog.providers.get(provider_id)
    if existing is None and preset is None:
        raise ValueError(f'Unknown provider "{provider_id}".')
    if existing is not None:
        if model:
            existing.model = model
    elif preset is not None:
        settings.providers[provider_id] = provider_config_from_preset(
            preset, model or preset.default_model
        )
    settings.active_provider = provider_id
    save_settings(settings, data_dir)
    return settings


def resolve_active_provider(
    settings: AppSettings, catalog: ProviderCatalog
) -> ProviderConfig | None:
    pid = settings.active_provider
    if not pid:
        return None
    if pid in settings.providers:
        return settings.providers[pid]
    preset = catalog.providers.get(pid)
    if not preset:
        return None
    return provider_config_from_preset(preset, settings.default_model or preset.default_model)
