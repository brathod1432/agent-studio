from __future__ import annotations

import json
import unittest
from typing import Any

from agent_studio.llm.types import ChatResponse, ToolCall
from agent_studio.tool_loop import run_tool_loop, tool_schema


def _call(name: str, args: dict[str, Any], cid: str = "c1") -> ToolCall:
    return ToolCall(id=cid, name=name, arguments=json.dumps(args))


class ToolSchemaTests(unittest.TestCase):
    def test_descriptor_to_openai_schema(self) -> None:
        schema = tool_schema(
            {"name": "text.stats", "description": "d", "inputSchema": {"type": "object", "properties": {}}}
        )
        self.assertEqual(schema["type"], "function")
        self.assertEqual(schema["function"]["name"], "text.stats")
        self.assertEqual(schema["function"]["parameters"], {"type": "object", "properties": {}})


class RunToolLoopTests(unittest.TestCase):
    def test_no_tool_calls_returns_final_immediately(self) -> None:
        llm = lambda msgs, tools: ChatResponse("hello")  # noqa: E731
        res = run_tool_loop(llm, [{"role": "user", "content": "hi"}], [], lambda n, a: None)
        self.assertEqual(res.content, "hello")
        self.assertEqual(res.stopped_reason, "final")
        self.assertEqual(res.tool_calls_made, 0)
        self.assertEqual(res.steps, 1)

    def test_executes_tool_then_returns_final_answer(self) -> None:
        responses = [
            ChatResponse("", tool_calls=[_call("text.stats", {"text": "a b c"})]),
            ChatResponse("There are 3 words."),
        ]
        calls: list[tuple[str, dict[str, Any]]] = []

        def llm(msgs, tools):
            # The tool result must have been threaded back before the 2nd call.
            if len(responses) == 1:
                self.assertTrue(any(m.get("role") == "tool" for m in msgs))
            return responses.pop(0)

        def execute(name, args):
            calls.append((name, args))
            return {"words": 3}

        res = run_tool_loop(llm, [{"role": "user", "content": "count"}], [], execute)
        self.assertEqual(res.content, "There are 3 words.")
        self.assertEqual(res.tool_calls_made, 1)
        self.assertEqual(calls, [("text.stats", {"text": "a b c"})])

    def test_denied_tool_call_feeds_error_not_execution(self) -> None:
        responses = [
            ChatResponse("", tool_calls=[_call("fs.summarize", {"path": "/etc"})]),
            ChatResponse("ok, skipping"),
        ]
        executed: list[str] = []

        def execute(name, args):
            executed.append(name)
            return {}

        res = run_tool_loop(
            lambda m, t: responses.pop(0),
            [{"role": "user", "content": "scan"}],
            [],
            execute,
            approve=lambda name, args: False,
        )
        self.assertEqual(executed, [])  # never executed
        self.assertEqual(res.content, "ok, skipping")
        self.assertEqual(res.tool_calls_made, 0)

    def test_tool_exception_is_surfaced_to_model_not_raised(self) -> None:
        responses = [
            ChatResponse("", tool_calls=[_call("boom", {})]),
            ChatResponse("recovered"),
        ]

        def execute(name, args):
            raise RuntimeError("kaboom")

        res = run_tool_loop(lambda m, t: responses.pop(0), [{"role": "user", "content": "x"}], [], execute)
        self.assertEqual(res.content, "recovered")
        # The error was threaded back as a tool message.
        tool_msgs = [m for m in res.messages if m.get("role") == "tool"]
        self.assertIn("kaboom", tool_msgs[-1]["content"])

    def test_max_steps_bound_stops_the_loop(self) -> None:
        # Always requests a tool -> would loop forever without the budget.
        def llm(msgs, tools):
            if not tools:  # final plain-answer request after budget
                return ChatResponse("giving up")
            return ChatResponse("", tool_calls=[_call("noop", {})])

        offered = [{"type": "function", "function": {"name": "noop"}}]
        res = run_tool_loop(
            llm, [{"role": "user", "content": "x"}], offered, lambda n, a: {"ok": True}, max_steps=3
        )
        self.assertEqual(res.stopped_reason, "max_steps")
        self.assertEqual(res.steps, 3)
        self.assertEqual(res.content, "giving up")


if __name__ == "__main__":
    unittest.main()
