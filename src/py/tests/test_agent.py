from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent_studio.agent import ChatAgent
from agent_studio.llm.types import ChatMessage, ChatResponse, TokenUsage
from agent_studio.memory.store import ConversationStore


class FakeClient:
    """Stand-in for OpenAICompatibleClient (records the request)."""

    def __init__(self, reply: str = "reply", usage: TokenUsage | None = None) -> None:
        self.model = "fake-model"
        self.provider_id = "fake"
        self._reply = reply
        self._usage = usage
        self.last_messages: list[ChatMessage] | None = None

    def chat(self, messages, **kw) -> ChatResponse:
        self.last_messages = list(messages)
        self.last_kwargs = dict(kw)
        return ChatResponse(self._reply, usage=self._usage)

    def chat_stream(self, messages, on_delta, *, should_cancel=None, **_kw) -> ChatResponse:
        self.last_messages = list(messages)
        # Emit word by word, honoring cancellation.
        emitted: list[str] = []
        for word in self._reply.split(" "):
            if should_cancel and should_cancel():
                return ChatResponse(" ".join(emitted), finish_reason="cancelled")
            emitted.append(word)
            on_delta(word + " ")
        return ChatResponse(self._reply, usage=self._usage)


def _agent(tmp: str, client: FakeClient, max_ctx: int = 0) -> tuple[ChatAgent, ConversationStore]:
    store = ConversationStore(data_dir=Path(tmp))
    conv = store.create(provider_id="nvidia", model=client.model)
    agent = ChatAgent(client, store, conv, system_prompt="SYS", max_context_tokens=max_ctx)
    return agent, store


class AgentTests(unittest.TestCase):
    def test_run_appends_and_persists_and_sends_system(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient("Hi back")
            agent, store = _agent(d, client)
            out = agent.run("Hello")
            self.assertEqual(out, "Hi back")
            self.assertEqual(agent.conversation.messages[0].content, "Hello")
            self.assertEqual(agent.conversation.messages[1].content, "Hi back")
            self.assertEqual(client.last_messages[0].role, "system")
            self.assertEqual(store.load(agent.conversation.id).title, "Hello")

    def test_run_forwards_model_temperature_and_max_tokens_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient("ok")
            agent, _ = _agent(d, client)
            agent.run("hi", model="meta/llama-3.1-8b-instruct", temperature=0.0, max_tokens=64)
            self.assertEqual(client.last_kwargs.get("model"), "meta/llama-3.1-8b-instruct")
            self.assertEqual(client.last_kwargs.get("temperature"), 0.0)
            self.assertEqual(client.last_kwargs.get("max_tokens"), 64)

    def test_custom_system_prompt_is_sent(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient("ok")
            store = ConversationStore(data_dir=Path(d))
            conv = store.create()
            agent = ChatAgent(client, store, conv, system_prompt="You are a strict reviewer.")
            agent.run("review this")
            self.assertEqual(client.last_messages[0].role, "system")
            self.assertEqual(client.last_messages[0].content, "You are a strict reviewer.")

    def test_exact_usage_vs_estimate(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient("one two three", usage=TokenUsage(7, 9, 16))
            agent, _ = _agent(d, client)
            agent.run_stream("go", lambda _d: None)
            self.assertEqual(agent.last_usage, TokenUsage(7, 9, 16))
            self.assertFalse(agent.last_usage_estimated)

        with tempfile.TemporaryDirectory() as d:
            client = FakeClient("a wordy reply here")
            agent, _ = _agent(d, client)
            agent.run_stream("a question", lambda _d: None)
            self.assertTrue(agent.last_usage_estimated)
            self.assertGreater(agent.last_usage.total_tokens, 0)

    def test_context_trim_keeps_system_and_latest(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient("reply")
            store = ConversationStore(data_dir=Path(d))
            conv = store.create(provider_id="nvidia", model="m")
            for i in range(10):
                store.append(conv, ChatMessage("user" if i % 2 == 0 else "assistant", f"{i}:" + "x" * 40))
            agent = ChatAgent(client, store, conv, system_prompt="SYS", max_context_tokens=40)
            agent.run("newest question")
            sent = client.last_messages
            self.assertEqual(sent[0].role, "system")
            self.assertEqual(sent[-1].content, "newest question")
            self.assertLess(len(sent), 12)
            self.assertGreater(agent.last_trimmed_count, 0)
            # Full history retained on disk.
            self.assertEqual(len(store.load(conv.id).messages), 12)

    def test_cancel_keeps_partial_and_persists(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient("one two three four")
            agent, store = _agent(d, client)
            state = {"n": 0}

            def cancel() -> bool:
                return state["n"] >= 2

            def on_delta(_dd: str) -> None:
                state["n"] += 1

            out = agent.run_stream("q", on_delta, should_cancel=cancel)
            self.assertTrue(out)  # partial content
            reloaded = store.load(agent.conversation.id)
            self.assertEqual(reloaded.messages[0].content, "q")
            self.assertEqual(reloaded.messages[1].content, out)

    def test_ephemeral_persists_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient("reply")
            store = ConversationStore(data_dir=Path(d), ephemeral=True)
            conv = store.create()
            agent = ChatAgent(client, store, conv, system_prompt="SYS")
            agent.run("hi")
            self.assertEqual(store.list(), [])


if __name__ == "__main__":
    unittest.main()
