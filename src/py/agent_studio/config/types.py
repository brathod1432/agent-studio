"""Config data types (parity with the TS ``config/types.ts``).

JSON on disk uses camelCase (baseUrl, apiKeyRef, defaultModel, maxContextTokens);
these dataclasses use snake_case and the loaders map between the two.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ProviderPreset:
    id: str
    label: str
    kind: str  # "openai-compatible" | "anthropic"
    base_url: str
    api_key_env: str
    requires_api_key: bool
    default_model: str
    docs_url: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class RequestSettings:
    timeout_ms: int = 30000
    max_retries: int = 2
    retry_base_delay_ms: int = 500


@dataclass
class ProviderConfig:
    id: str
    label: str
    kind: str
    base_url: str
    model: str
    api_key_ref: str | None = None


@dataclass(frozen=True)
class DefaultConfig:
    active_provider: str | None
    default_model: str
    request: RequestSettings
    max_context_tokens: int = 0
    max_output_tokens: int = 0


@dataclass
class AppSettings:
    active_provider: str | None
    default_model: str
    providers: dict[str, ProviderConfig] = field(default_factory=dict)
    request: RequestSettings = field(default_factory=RequestSettings)
    max_context_tokens: int = 0
    max_output_tokens: int = 0


@dataclass(frozen=True)
class ProviderCatalog:
    providers: dict[str, ProviderPreset]
