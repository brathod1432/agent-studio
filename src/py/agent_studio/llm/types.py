"""Chat/LLM data types (parity with the TS ``llm/types.ts``)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ChatMessage:
    role: str  # "system" | "user" | "assistant"
    content: str

    def to_dict(self) -> dict[str, str]:
        return {"role": self.role, "content": self.content}


@dataclass
class TokenUsage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


@dataclass
class ToolCall:
    """A tool/function call requested by the model."""

    id: str
    name: str
    arguments: str  # raw JSON string as returned by the provider


@dataclass
class ChatResponse:
    content: str
    model: str | None = None
    finish_reason: str | None = None
    usage: TokenUsage | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
