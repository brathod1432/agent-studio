from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent_studio.tools.base import ToolError
from agent_studio.tools.registry import default_registry


class RegistryTests(unittest.TestCase):
    def test_lists_all_tools_with_descriptors(self) -> None:
        reg = default_registry()
        names = reg.names()
        for expected in [
            "code.analyze",
            "text.stats",
            "text.summarize",
            "data.csv_to_json",
            "data.json_query",
            "diff.unified",
            "report.markdown",
            "fs.summarize",
        ]:
            self.assertIn(expected, names)
        for d in reg.list():
            self.assertIn("name", d)
            self.assertIn("description", d)
            self.assertIn("inputSchema", d)

    def test_unknown_tool_raises(self) -> None:
        with self.assertRaises(ToolError):
            default_registry().call("nope", {})


class CodeToolTests(unittest.TestCase):
    def test_analyze_python_source(self) -> None:
        reg = default_registry()
        src = (
            "import os\nfrom a.b import c\n\ndef foo(x, y):\n    return x\n\n"
            "class Bar:\n    def m(self):\n        pass\n"
        )
        out = reg.call("code.analyze", {"source": src})
        self.assertEqual(out["counts"]["functions"], 1)
        self.assertEqual(out["counts"]["classes"], 1)
        self.assertEqual(out["functions"][0]["name"], "foo")
        self.assertEqual(out["functions"][0]["args"], 2)
        self.assertEqual(out["classes"][0]["methods"], ["m"])
        self.assertIn("os", out["imports"])
        self.assertIn("a.b.c", out["imports"])

    def test_syntax_error_is_tool_error(self) -> None:
        with self.assertRaises(ToolError):
            default_registry().call("code.analyze", {"source": "def ("})


class TextToolTests(unittest.TestCase):
    def test_stats(self) -> None:
        out = default_registry().call("text.stats", {"text": "the cat sat on the cat mat"})
        self.assertEqual(out["words"], 7)
        self.assertGreaterEqual(out["unique_words"], 4)
        self.assertEqual(out["top_words"][0][0], "cat")  # most frequent non-stopword

    def test_summarize_selects_sentences(self) -> None:
        text = "Cats are great. Cats purr and cats sleep. The weather is unrelated today."
        out = default_registry().call("text.summarize", {"text": text, "max_sentences": 1})
        self.assertEqual(out["sentence_count"], 3)
        self.assertIn("cats", out["summary"].lower())


class CodeComplexityTests(unittest.TestCase):
    def test_complexity_scores_and_hotspots(self) -> None:
        src = (
            "def simple():\n    return 1\n\n"
            "def branchy(x):\n"
            "    if x > 0 and x < 10:\n        return 1\n"
            "    for i in range(x):\n"
            "        if i % 2 == 0:\n            pass\n"
            "    return 0\n"
        )
        out = default_registry().call("code.complexity", {"source": src})
        self.assertEqual(out["count"], 2)
        names = {f["name"]: f["complexity"] for f in out["functions"]}
        self.assertEqual(names["simple"], 1)
        self.assertGreater(names["branchy"], names["simple"])
        self.assertGreaterEqual(out["max_complexity"], names["branchy"])


class DataToolTests(unittest.TestCase):
    def test_csv_to_json_with_header(self) -> None:
        out = default_registry().call("data.csv_to_json", {"csv": "a,b\n1,2\n3,4\n"})
        self.assertEqual(out["count"], 2)
        self.assertEqual(out["rows"][0], {"a": "1", "b": "2"})

    def test_summarize_csv_numeric_columns(self) -> None:
        out = default_registry().call("data.summarize_csv", {"csv": "name,score\na,10\nb,20\nc,30\n"})
        self.assertEqual(out["rows"], 3)
        self.assertIn("score", out["numeric"])
        self.assertEqual(out["numeric"]["score"]["min"], 10.0)
        self.assertEqual(out["numeric"]["score"]["max"], 30.0)
        self.assertEqual(out["numeric"]["score"]["mean"], 20.0)
        self.assertNotIn("name", out["numeric"])  # non-numeric column excluded

    def test_json_query_dotted_path(self) -> None:
        out = default_registry().call("data.json_query", {"data": {"a": {"b": [10, 20]}}, "path": "a.b.1"})
        self.assertEqual(out["value"], 20)
        with self.assertRaises(ToolError):
            default_registry().call("data.json_query", {"data": {}, "path": "missing"})


class DiffToolTests(unittest.TestCase):
    def test_unified_diff_counts(self) -> None:
        out = default_registry().call("diff.unified", {"a": "one\ntwo\n", "b": "one\nTWO\n"})
        self.assertTrue(out["changed"])
        self.assertEqual(out["added"], 1)
        self.assertEqual(out["removed"], 1)
        self.assertIn("+TWO", out["diff"])


class ReportToolTests(unittest.TestCase):
    def test_markdown_report(self) -> None:
        out = default_registry().call(
            "report.markdown",
            {"title": "Findings", "sections": [{"heading": "Summary", "body": "All good."}]},
        )
        self.assertTrue(out["markdown"].startswith("# Findings"))
        self.assertIn("## Summary", out["markdown"])
        self.assertIn("All good.", out["markdown"])


class FsToolTests(unittest.TestCase):
    def test_summarize_dir(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
            (root / "sub").mkdir()
            (root / "sub" / "b.py").write_text("print('x')\n", encoding="utf-8")
            out = default_registry().call("fs.summarize", {"path": str(root)})
            self.assertEqual(out["file_count"], 2)
            paths = {f["path"] for f in out["files"]}
            self.assertIn("a.txt", paths)
            self.assertIn("sub/b.py", paths)

    def test_missing_dir_is_tool_error(self) -> None:
        with self.assertRaises(ToolError):
            default_registry().call("fs.summarize", {"path": "/no/such/dir/here/xyz"})

    def test_skips_sensitive_files_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "app.py").write_text("print('x')\n", encoding="utf-8")
            (root / ".env").write_text("NVIDIA_API_KEY=secret\n", encoding="utf-8")
            out = default_registry().call("fs.summarize", {"path": str(root)})
            paths = {f["path"] for f in out["files"]}
            self.assertIn("app.py", paths)
            self.assertNotIn(".env", paths)  # sensitive file hidden
            self.assertEqual(out["skipped_sensitive"], 1)
            # Opt-in surfaces it.
            out2 = default_registry().call("fs.summarize", {"path": str(root), "allow_sensitive": True})
            self.assertIn(".env", {f["path"] for f in out2["files"]})


class CodeToolSafetyTests(unittest.TestCase):
    def test_refuses_sensitive_path_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / ".env"
            env.write_text("NVIDIA_API_KEY=secret\n", encoding="utf-8")
            with self.assertRaises(ToolError):
                default_registry().call("code.analyze", {"path": str(env)})


if __name__ == "__main__":
    unittest.main()
