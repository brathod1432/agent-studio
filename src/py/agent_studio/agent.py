"""ChatAgent — load memory, append user, call LLM, append assistant, persist.

Mirrors the TS ChatAgent: context-window trimming (request-only, full history
stays on disk), per-turn token usage (exact or estimated), and cancellation
that keeps the partial reply.
"""

from __future__ import annotations

from collections.abc import Callable

from .llm.client import OpenAICompatibleClient
from .llm.types import ChatMessage, ChatResponse, TokenUsage
from .llm.usage import estimate_tokens_from_text, estimate_usage, has_token_counts, trim_messages
from .memory.store import Conversation, ConversationStore
from .prompts import render_system_prompt

DeltaHandler = Callable[[str], None]
CancelFn = Callable[[], bool]


class ChatAgent:
    def __init__(
        self,
        llm: OpenAICompatibleClient,
        store: ConversationStore,
        conversation: Conversation,
        *,
        system_prompt: str | None = None,
        max_context_tokens: int = 0,
    ) -> None:
        self._llm = llm
        self._store = store
        self._conversation = conversation
        self._max_context_tokens = max_context_tokens
        self._system_prompt = system_prompt if system_prompt is not None else render_system_prompt(llm.model)
        self.last_usage: TokenUsage | None = None
        self.last_usage_estimated = False
        self.last_trimmed_count = 0

    @property
    def conversation(self) -> Conversation:
        return self._conversation

    def _build_messages(self) -> list[ChatMessage]:
        system = ChatMessage("system", self._system_prompt)
        if self._max_context_tokens <= 0:
            self.last_trimmed_count = 0
            return [system, *self._conversation.messages]
        budget = max(1, self._max_context_tokens - estimate_tokens_from_text(self._system_prompt))
        kept, dropped = trim_messages(self._conversation.messages, budget)
        self.last_trimmed_count = dropped
        return [system, *kept]

    def _record_usage(self, messages: list[ChatMessage], response: ChatResponse) -> None:
        if has_token_counts(response.usage):
            self.last_usage = response.usage
            self.last_usage_estimated = False
        else:
            self.last_usage = estimate_usage(messages, response.content)
            self.last_usage_estimated = True

    def run(
        self,
        user_input: str,
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        self._store.append(self._conversation, ChatMessage("user", user_input))
        messages = self._build_messages()
        response = self._llm.chat(messages, model=model, temperature=temperature, max_tokens=max_tokens)
        if response.content:
            self._store.append(self._conversation, ChatMessage("assistant", response.content))
        self._store.save(self._conversation)
        self._record_usage(messages, response)
        return response.content

    def run_stream(
        self,
        user_input: str,
        on_delta: DeltaHandler,
        should_cancel: CancelFn | None = None,
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        self._store.append(self._conversation, ChatMessage("user", user_input))
        messages = self._build_messages()
        response = self._llm.chat_stream(
            messages,
            on_delta,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            should_cancel=should_cancel,
        )
        # Persist the turn even when cancelled: question + any partial reply.
        if response.content:
            self._store.append(self._conversation, ChatMessage("assistant", response.content))
        self._store.save(self._conversation)
        self._record_usage(messages, response)
        return response.content
