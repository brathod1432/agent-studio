from __future__ import annotations

import json
import unittest

from agent_studio.config.types import ProviderConfig, RequestSettings
from agent_studio.llm.client import OpenAICompatibleClient
from agent_studio.llm.types import ChatMessage
from agent_studio.llm.usage import add_usage, estimate_usage, trim_messages, zero_usage
from agent_studio.providers.errors import ProviderError
from tests.fakes import FakeResponse, make_http_open, sse_lines

REQUEST = RequestSettings(timeout_ms=50, max_retries=2, retry_base_delay_ms=1)
KEY = "nvapi-test-key-abcd1234"


def nvidia_config() -> ProviderConfig:
    return ProviderConfig(
        id="nvidia",
        label="NVIDIA",
        kind="openai-compatible",
        base_url="https://integrate.api.nvidia.com/v1",
        model="nvidia/model",
        api_key_ref="env:NVIDIA_API_KEY",
    )


def completion_json(content: str) -> str:
    return json.dumps(
        {
            "model": "test-model",
            "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
        }
    )


class ChatTests(unittest.TestCase):
    def test_chat_posts_model_messages_and_bearer(self) -> None:
        http, calls = make_http_open([FakeResponse(200, completion_json("Hello there"))])
        client = OpenAICompatibleClient(nvidia_config(), KEY, REQUEST, http)
        res = client.chat([ChatMessage("user", "hi")])
        self.assertEqual(res.content, "Hello there")
        self.assertEqual(res.usage.total_tokens, 8)
        self.assertTrue(calls[0]["url"].endswith("/chat/completions"))
        self.assertEqual(calls[0]["headers"]["Authorization"], f"Bearer {KEY}")
        self.assertEqual(calls[0]["body"]["stream"], False)

    def test_missing_key_raises_before_any_request(self) -> None:
        http, calls = make_http_open([FakeResponse(200, completion_json("x"))])
        client = OpenAICompatibleClient(nvidia_config(), None, REQUEST, http)
        with self.assertRaises(ProviderError) as ctx:
            client.chat([ChatMessage("user", "hi")])
        self.assertEqual(ctx.exception.kind, "missing_api_key")
        self.assertEqual(len(calls), 0)


class StreamTests(unittest.TestCase):
    def test_stream_emits_deltas_and_captures_usage(self) -> None:
        lines = sse_lines(["Hello", " world"], usage={"prompt_tokens": 11, "completion_tokens": 22, "total_tokens": 33})
        http, calls = make_http_open([FakeResponse(200, sse_lines=lines)])
        client = OpenAICompatibleClient(nvidia_config(), KEY, REQUEST, http)
        deltas: list[str] = []
        res = client.chat_stream([ChatMessage("user", "hi")], deltas.append)
        self.assertEqual(deltas, ["Hello", " world"])
        self.assertEqual(res.content, "Hello world")
        self.assertEqual(res.usage.total_tokens, 33)
        self.assertEqual(calls[0]["body"]["stream_options"], {"include_usage": True})

    def test_stream_cancel_returns_partial(self) -> None:
        lines = sse_lines(["one", "two", "three"])
        http, _ = make_http_open([FakeResponse(200, sse_lines=lines)])
        client = OpenAICompatibleClient(nvidia_config(), KEY, REQUEST, http)
        seen: list[str] = []
        # Cancel after the first delta.
        state = {"n": 0}

        def cancel() -> bool:
            return state["n"] >= 1

        def on_delta(d: str) -> None:
            seen.append(d)
            state["n"] += 1

        res = client.chat_stream([ChatMessage("user", "hi")], on_delta, should_cancel=cancel)
        self.assertEqual(res.finish_reason, "cancelled")
        self.assertEqual(seen, ["one"])  # stopped early


class RetryTests(unittest.TestCase):
    def test_retries_transient_503_then_succeeds(self) -> None:
        http, calls = make_http_open([FakeResponse(503, "busy"), FakeResponse(200, completion_json("ok"))])
        client = OpenAICompatibleClient(nvidia_config(), KEY, REQUEST, http)
        res = client.chat([ChatMessage("user", "hi")])
        self.assertEqual(res.content, "ok")
        self.assertEqual(len(calls), 2)

    def test_does_not_retry_401(self) -> None:
        http, calls = make_http_open([FakeResponse(401, "nope")])
        client = OpenAICompatibleClient(nvidia_config(), KEY, REQUEST, http)
        with self.assertRaises(ProviderError) as ctx:
            client.chat([ChatMessage("user", "hi")])
        self.assertEqual(ctx.exception.kind, "invalid_api_key")
        self.assertEqual(len(calls), 1)

    def test_gives_up_after_max_retries(self) -> None:
        http, calls = make_http_open([FakeResponse(500, "boom")])
        client = OpenAICompatibleClient(nvidia_config(), KEY, REQUEST, http)
        with self.assertRaises(ProviderError) as ctx:
            client.chat([ChatMessage("user", "hi")])
        self.assertEqual(ctx.exception.kind, "server")
        self.assertEqual(len(calls), REQUEST.max_retries + 1)


class UsageTests(unittest.TestCase):
    def test_estimate_and_add_and_trim(self) -> None:
        u = estimate_usage([ChatMessage("user", "x" * 40)], "y" * 40)
        self.assertGreater(u.total_tokens, 0)
        summed = add_usage(zero_usage(), u)
        self.assertEqual(summed.total_tokens, u.total_tokens)

        msgs = [ChatMessage("user", f"{i}:" + "x" * 40) for i in range(5)]
        kept, dropped = trim_messages(msgs, 32)
        self.assertLess(len(kept), 5)
        self.assertEqual(dropped, 5 - len(kept))
        self.assertEqual(kept[-1].content, msgs[-1].content)  # newest kept

        unlimited, d0 = trim_messages(msgs, 0)
        self.assertEqual(len(unlimited), 5)
        self.assertEqual(d0, 0)


if __name__ == "__main__":
    unittest.main()
