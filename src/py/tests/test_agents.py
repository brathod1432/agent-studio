from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Any

from agent_studio.agents.catalog import load_catalog
from agent_studio.agents.policy import PolicyError, make_executor, resolve_allowed_tools
from agent_studio.agents.runner import run_agent
from agent_studio.agents.spec import AgentPolicy, AgentSpec
from agent_studio.agents.workflows import code_review, security_audit
from agent_studio.llm.types import ChatResponse, ToolCall
from agent_studio.tools.base import ToolError
from agent_studio.tools.registry import default_registry


def _spec(**kw: Any) -> AgentSpec:
    base = dict(
        id="t",
        name="T",
        description="",
        workflow="agentic",
        pipeline=None,
        tools=("text.stats",),
        policy=AgentPolicy(read_only=True, auto_approve=True, max_steps=4),
        prompt="be helpful",
        directory=Path("."),
    )
    base.update(kw)
    return AgentSpec(**base)  # type: ignore[arg-type]


class CatalogTests(unittest.TestCase):
    def test_loads_the_shipped_catalog(self) -> None:
        catalog = load_catalog()  # real agents/ dir at the repo root
        for expected in ["code-reviewer", "security-auditor", "data-analyst", "doc-writer"]:
            self.assertIn(expected, catalog)
        cr = catalog["code-reviewer"]
        self.assertEqual(cr.workflow, "pipeline")
        self.assertTrue(cr.policy.read_only)
        self.assertIn("code.analyze", cr.tools)
        self.assertTrue(cr.prompt)  # prompt.md loaded


class PolicyTests(unittest.TestCase):
    def test_resolve_allowed_tools_rejects_unknown(self) -> None:
        reg = default_registry()
        with self.assertRaises(PolicyError):
            resolve_allowed_tools(_spec(tools=("nope.tool",)), reg)

    def test_executor_refuses_tools_outside_allowlist(self) -> None:
        reg = default_registry()
        execute = make_executor(_spec(tools=("text.stats",)), reg)
        self.assertEqual(execute("text.stats", {"text": "a b"})["words"], 2)
        with self.assertRaises(ToolError):
            execute("fs.summarize", {"path": "."})  # not allow-listed


class PipelineTests(unittest.TestCase):
    def test_code_review_pipeline(self) -> None:
        reg = default_registry()
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "m.py").write_text(
                "import os\n\ndef f(a, b, c, d, e, f):\n    return a\n", encoding="utf-8"
            )
            result = code_review.run(reg, d)
            self.assertGreaterEqual(result["files_reviewed"], 1)
            self.assertIn("Code Review", result["report"])
            # 6-arg function should be flagged.
            self.assertTrue(any("args" in f["finding"] for f in result["findings"]))

    def test_security_audit_flags_secret_and_sensitive_file(self) -> None:
        reg = default_registry()
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "app.py").write_text("KEY = 'nvapi-ABCDEF0123456789ZZZZ'\n", encoding="utf-8")
            (Path(d) / ".env").write_text("SECRET=x\n", encoding="utf-8")
            result = security_audit.run(reg, d)
            self.assertIn(".env", result["sensitive_files"])
            self.assertTrue(result["secret_hits"])  # nvapi key detected in app.py
            self.assertIn("Security Audit", result["report"])
            # The report must NOT contain the raw secret value.
            self.assertNotIn("nvapi-ABCDEF0123456789ZZZZ", result["report"])


class RunnerTests(unittest.TestCase):
    def test_run_pipeline_agent(self) -> None:
        reg = default_registry()
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "x.py").write_text("def a():\n    return 1\n", encoding="utf-8")
            spec = _spec(workflow="pipeline", pipeline="code_review", tools=("code.analyze", "report.markdown"))
            res = run_agent(spec, d, reg)
            self.assertEqual(res.workflow, "pipeline")
            self.assertIn("Code Review", res.content)

    def test_run_agentic_agent_with_fake_llm(self) -> None:
        reg = default_registry()
        responses = [
            ChatResponse("", tool_calls=[ToolCall("c1", "text.stats", '{"text":"a b c"}')]),
            ChatResponse("It has 3 words."),
        ]
        spec = _spec(tools=("text.stats",))
        res = run_agent(spec, "count words in 'a b c'", reg, llm=lambda m, t: responses.pop(0))
        self.assertEqual(res.content, "It has 3 words.")
        self.assertEqual(res.tool_calls_made, 1)

    def test_agentic_agent_cannot_call_tools_outside_allowlist(self) -> None:
        reg = default_registry()
        # Model tries to call fs.summarize, but the agent only allows text.stats.
        responses = [
            ChatResponse("", tool_calls=[ToolCall("c1", "fs.summarize", '{"path":"/"}')]),
            ChatResponse("done"),
        ]
        spec = _spec(tools=("text.stats",))
        res = run_agent(spec, "x", reg, llm=lambda m, t: responses.pop(0))
        # The disallowed call surfaced an error to the model (0 successful calls).
        self.assertEqual(res.tool_calls_made, 0)
        self.assertEqual(res.content, "done")


if __name__ == "__main__":
    unittest.main()
