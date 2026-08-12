"""Build an LLM client from the active settings + resolved API key."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .config.loader import load_catalog, load_settings, resolve_active_provider
from .config.types import AppSettings, ProviderConfig
from .core.redact import register_secret_value
from .core.secrets import resolve_secret
from .llm.client import OpenAICompatibleClient
from .providers.errors import ProviderError


@dataclass
class ResolvedLLM:
    client: OpenAICompatibleClient
    config: ProviderConfig
    settings: AppSettings


def create_llm_from_settings(env: Mapping[str, str]) -> ResolvedLLM:
    settings = load_settings()
    catalog = load_catalog()
    config = resolve_active_provider(settings, catalog)
    if config is None:
        raise ProviderError("invalid_config", "No provider is configured. Run onboarding first.")
    resolved = resolve_secret(config.api_key_ref, env)
    if resolved.present and resolved.secret:
        register_secret_value(resolved.secret.reveal())
    api_key = resolved.secret.reveal() if resolved.secret else None
    client = OpenAICompatibleClient(config, api_key, settings.request)
    return ResolvedLLM(client=client, config=config, settings=settings)
