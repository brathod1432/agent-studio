from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from agent_studio.config.loader import (
    load_catalog,
    load_settings,
    resolve_active_provider,
    set_active_model,
    set_active_provider,
)
from agent_studio.context import expand_file_references, extract_file_refs, is_sensitive_path
from agent_studio.core.secret_scan import describe_secret_kinds, detect_secrets
from agent_studio.prompts import render_system_prompt, render_template


class SecretScanTests(unittest.TestCase):
    def test_detects_kinds_without_leaking_value(self) -> None:
        self.assertEqual(detect_secrets("key nvapi-abcdef0123456789ABCDEF"), ["NVIDIA API key"])
        self.assertEqual(detect_secrets("use sk-abcdef0123456789ABCDEFGH"), ["OpenAI-style API key"])
        self.assertEqual(detect_secrets("AKIAIOSFODNN7EXAMPLE"), ["AWS access key id"])
        self.assertEqual(detect_secrets("Can you review this function?"), [])
        kinds = detect_secrets("nvapi-SUPERSECRET0123456789")
        self.assertTrue(all("SUPERSECRET" not in k for k in kinds))

    def test_describe_uses_articles(self) -> None:
        self.assertEqual(describe_secret_kinds(["bearer token"]), "a bearer token")
        self.assertEqual(describe_secret_kinds(["NVIDIA API key"]), "an NVIDIA API key")
        self.assertEqual(
            describe_secret_kinds(["NVIDIA API key", "bearer token"]),
            "an NVIDIA API key and a bearer token",
        )


class FileContextTests(unittest.TestCase):
    def test_extract_and_expand(self) -> None:
        self.assertEqual(extract_file_refs("explain @a.py and @b.md"), ["a.py", "b.md"])
        self.assertEqual(extract_file_refs("email me at user@example.com"), [])

        def fake_read(path: str) -> tuple[str, bool, int]:
            return ("CONTENT", False, 7)

        res = expand_file_references("review @a.py", read=fake_read)
        self.assertTrue(res.refs[0].ok)
        self.assertIn("File: a.py", res.text)
        self.assertIn("CONTENT", res.text)

    def test_missing_file_is_reported_not_fatal(self) -> None:
        def boom(path: str) -> tuple[str, bool, int]:
            raise OSError("no such file")

        res = expand_file_references("look at @missing.txt", read=boom)
        self.assertFalse(res.refs[0].ok)
        self.assertEqual(res.text, "look at @missing.txt")

    def test_real_file_relative_to_cwd(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "hello.txt").write_text("hello from disk", encoding="utf-8")
            res = expand_file_references("summarize @hello.txt", cwd=Path(d))
            self.assertTrue(res.refs[0].ok)
            self.assertIn("hello from disk", res.text)


class FileSafetyTests(unittest.TestCase):
    def _boom(self, _path: str) -> tuple[str, bool, int]:
        raise AssertionError("reader should not be called for a blocked file")

    def test_is_sensitive_path(self) -> None:
        self.assertTrue(is_sensitive_path("/proj/.env"))
        self.assertTrue(is_sensitive_path("/home/u/.ssh/id_rsa"))
        self.assertTrue(is_sensitive_path("/home/u/.aws/credentials"))
        self.assertTrue(is_sensitive_path("/proj/server.pem"))
        self.assertFalse(is_sensitive_path("/proj/src/app.py"))

    def test_outside_workspace_is_blocked_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d) / "proj"
            root.mkdir()
            res = expand_file_references("read @../secret.txt", cwd=root, workspace_root=root, read=self._boom)
            self.assertTrue(res.refs[0].blocked)
            self.assertIn("outside the workspace", res.refs[0].error)
            self.assertEqual(res.text, "read @../secret.txt")

    def test_sensitive_file_is_blocked_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            res = expand_file_references("read @.env", cwd=root, workspace_root=root, read=self._boom)
            self.assertTrue(res.refs[0].blocked)
            self.assertIn("sensitive", res.refs[0].error)

    def test_allow_flags_relax_guards(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / ".env").write_text("NVIDIA_API_KEY=secret", encoding="utf-8")
            res = expand_file_references("read @.env", cwd=root, workspace_root=root, allow_sensitive=True)
            self.assertTrue(res.refs[0].ok)
            self.assertIn("NVIDIA_API_KEY", res.text)


class PromptTests(unittest.TestCase):
    def test_render_and_system_prompt(self) -> None:
        self.assertEqual(render_template("hi {{ name }}", {"name": "x"}), "hi x")
        self.assertEqual(render_template("{{missing}}"), "")
        rendered = render_system_prompt("nvidia/model-x")
        self.assertIn("nvidia/model-x", rendered)


class ConfigWriterTests(unittest.TestCase):
    def test_set_active_model_and_provider_persist_secret_safe(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            data = Path(d)
            set_active_model("meta/llama-3.1-8b-instruct", data_dir=data)
            s = load_settings(data_dir=data, warn=False)
            active = resolve_active_provider(s, load_catalog())
            self.assertEqual(active.model, "meta/llama-3.1-8b-instruct")
            raw = (data / "settings.json").read_text(encoding="utf-8")
            self.assertIn("env:NVIDIA_API_KEY", raw)
            self.assertNotIn("nvapi-", raw)

            set_active_provider("ollama", data_dir=data)
            s2 = load_settings(data_dir=data, warn=False)
            self.assertEqual(s2.active_provider, "ollama")
            self.assertEqual(
                s2.providers["ollama"].model, load_catalog().providers["ollama"].default_model
            )

    def test_set_active_provider_rejects_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                set_active_provider("does-not-exist", data_dir=Path(d))


if __name__ == "__main__":
    unittest.main()
