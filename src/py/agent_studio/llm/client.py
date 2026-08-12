"""OpenAI-compatible chat client (Ollama, NVIDIA, and any compatible endpoint).

Standard-library only. Supports non-streaming and SSE streaming, automatic
retry with backoff on transient errors (parity with the TS client), token-usage
capture, and cooperative cancellation.
"""

from __future__ import annotations

import json
import random
import time
from collections.abc import Callable, Iterable
from typing import Any

from ..config.types import ProviderConfig, RequestSettings
from ..core.http import HttpResponse, TransportError, join_url, open_http
from .types import ChatMessage, ChatResponse, TokenUsage

HttpOpen = Callable[..., HttpResponse]
DeltaHandler = Callable[[str], None]
CancelFn = Callable[[], bool]

MAX_BACKOFF_MS = 20_000


def _backoff_ms(err: Any, attempt: int, base_ms: int) -> float:
    from_server: float | None = None
    retry_after = getattr(err, "retry_after_seconds", None)
    if retry_after is not None:
        from_server = float(retry_after) * 1000
    exponential = base_ms * (2**attempt) + random.randint(0, 100)
    return float(min(from_server if from_server is not None else exponential, MAX_BACKOFF_MS))


class OpenAICompatibleClient:
    def __init__(
        self,
        config: ProviderConfig,
        api_key: str | None,
        request: RequestSettings,
        http_open: HttpOpen = open_http,
    ) -> None:
        self.config = config
        self._api_key = api_key
        self._request = request
        self._http_open = http_open

    @property
    def provider_id(self) -> str:
        return self.config.id

    @property
    def model(self) -> str:
        return self.config.model

    # -- helpers -----------------------------------------------------------
    def _headers(self, accept: str) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": accept}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _require_key(self) -> None:
        from ..providers.errors import missing_api_key

        if self.config.api_key_ref and not self._api_key:
            raise missing_api_key(self.config.api_key_ref.replace("env:", "", 1))

    def _body(
        self,
        messages: Iterable[ChatMessage],
        model: str | None,
        temperature: float | None,
        stream: bool,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model or self.config.model,
            "messages": [m.to_dict() for m in messages],
            "stream": stream,
        }
        if stream:
            body["stream_options"] = {"include_usage": True}
        if temperature is not None:
            body["temperature"] = temperature
        return body

    def _should_retry(self, err: Any, attempt: int, cancelled: bool) -> bool:
        return bool(getattr(err, "retryable", False)) and attempt < self._request.max_retries and not cancelled

    def _sleep(self, err: Any, attempt: int, should_cancel: CancelFn | None) -> None:
        time.sleep(_backoff_ms(err, attempt, self._request.retry_base_delay_ms) / 1000.0)

    # -- non-streaming -----------------------------------------------------
    def chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        should_cancel: CancelFn | None = None,
    ) -> ChatResponse:
        from ..providers.errors import error_from_status, error_from_transport

        self._require_key()
        url = join_url(self.config.base_url, "chat/completions")
        timeout = self._request.timeout_ms / 1000.0
        body = self._body(messages, model, temperature, stream=False)

        attempt = 0
        while True:
            if should_cancel and should_cancel():
                return ChatResponse(content="", finish_reason="cancelled")
            try:
                resp = self._http_open("POST", url, self._headers("application/json"), body, timeout)
            except TransportError as err:
                perr = error_from_transport(err)
                if self._should_retry(perr, attempt, bool(should_cancel and should_cancel())):
                    self._sleep(perr, attempt, should_cancel)
                    attempt += 1
                    continue
                raise perr from err
            if resp.status >= 400:
                perr = error_from_status(resp.status, resp.header("retry-after"), resp.read_text())
                if self._should_retry(perr, attempt, bool(should_cancel and should_cancel())):
                    self._sleep(perr, attempt, should_cancel)
                    attempt += 1
                    continue
                raise perr
            data = json.loads(resp.read_text() or "{}")
            return _parse_completion(data)

    # -- streaming ---------------------------------------------------------
    def chat_stream(
        self,
        messages: list[ChatMessage],
        on_delta: DeltaHandler,
        *,
        model: str | None = None,
        temperature: float | None = None,
        should_cancel: CancelFn | None = None,
    ) -> ChatResponse:
        from ..providers.errors import error_from_status, error_from_transport

        self._require_key()
        url = join_url(self.config.base_url, "chat/completions")
        timeout = self._request.timeout_ms / 1000.0
        body = self._body(messages, model, temperature, stream=True)

        # Establish the connection with retry (before any delta is emitted).
        attempt = 0
        resp: HttpResponse
        while True:
            if should_cancel and should_cancel():
                return ChatResponse(content="", finish_reason="cancelled")
            try:
                resp = self._http_open("POST", url, self._headers("text/event-stream"), body, timeout)
            except TransportError as err:
                perr = error_from_transport(err)
                if self._should_retry(perr, attempt, False):
                    self._sleep(perr, attempt, should_cancel)
                    attempt += 1
                    continue
                raise perr from err
            if resp.status >= 400:
                perr = error_from_status(resp.status, resp.header("retry-after"), resp.read_text())
                if self._should_retry(perr, attempt, False):
                    self._sleep(perr, attempt, should_cancel)
                    attempt += 1
                    continue
                raise perr
            break

        full: list[str] = []
        model_out: str | None = None
        finish_reason: str | None = None
        usage: TokenUsage | None = None

        for line in resp.iter_lines():
            if should_cancel and should_cancel():
                resp.close()
                return ChatResponse("".join(full), model_out, "cancelled", usage)
            line = line.strip()
            if not line.startswith("data:"):
                continue
            payload = line[len("data:") :].strip()
            if payload == "[DONE]":
                break
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if parsed.get("model"):
                model_out = parsed["model"]
            if parsed.get("usage"):
                usage = _usage_from(parsed["usage"])
            choices = parsed.get("choices") or []
            if choices:
                choice = choices[0]
                delta = (choice.get("delta") or {}).get("content") or (
                    choice.get("message") or {}
                ).get("content") or ""
                if choice.get("finish_reason"):
                    finish_reason = choice["finish_reason"]
                if delta:
                    full.append(delta)
                    on_delta(delta)
        return ChatResponse("".join(full), model_out, finish_reason, usage)


def _usage_from(raw: dict[str, Any]) -> TokenUsage:
    return TokenUsage(
        prompt_tokens=raw.get("prompt_tokens"),
        completion_tokens=raw.get("completion_tokens"),
        total_tokens=raw.get("total_tokens"),
    )


def _parse_completion(data: dict[str, Any]) -> ChatResponse:
    choices = data.get("choices") or []
    choice = choices[0] if choices else {}
    content = (choice.get("message") or {}).get("content") or ""
    usage = _usage_from(data["usage"]) if data.get("usage") else None
    return ChatResponse(content, data.get("model"), choice.get("finish_reason"), usage)
