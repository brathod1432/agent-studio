from __future__ import annotations

import unittest

from agent_studio.core.redact import (
    clear_registered_secrets,
    register_secret_value,
    scrub_string,
)
from agent_studio.core.secrets import (
    Secret,
    env_ref,
    load_environment,
    mask_secret,
    parse_env,
    parse_secret_ref,
    resolve_secret,
)


class MaskSecretTests(unittest.TestCase):
    def test_mask_rules_match_typescript(self) -> None:
        self.assertEqual(mask_secret(None), "(not set)")
        self.assertEqual(mask_secret(""), "(not set)")
        self.assertEqual(mask_secret("short"), "********")  # len <= 8
        self.assertEqual(mask_secret("12345678"), "********")
        self.assertEqual(mask_secret("nvapi-abcdEFGH"), "****EFGH")

    def test_secret_never_leaks_via_str_or_repr(self) -> None:
        s = Secret("nvapi-supersecret-value-1234")
        self.assertNotIn("supersecret", str(s))
        self.assertNotIn("supersecret", repr(s))
        self.assertEqual(str(s), "****1234")
        self.assertEqual(s.reveal(), "nvapi-supersecret-value-1234")


class SecretRefTests(unittest.TestCase):
    def test_parse_only_accepts_env_refs(self) -> None:
        self.assertEqual(parse_secret_ref("env:NVIDIA_API_KEY").name, "NVIDIA_API_KEY")
        self.assertEqual(parse_secret_ref("BARE_NAME").name, "BARE_NAME")  # defaults to env
        self.assertIsNone(parse_secret_ref("vault:foo"))
        self.assertIsNone(parse_secret_ref(""))
        self.assertEqual(env_ref("X"), "env:X")

    def test_resolve_reads_from_env_and_wraps_safely(self) -> None:
        got = resolve_secret("env:NVIDIA_API_KEY", {"NVIDIA_API_KEY": "nvapi-xyz-1234"})
        self.assertTrue(got.present)
        self.assertIsInstance(got.secret, Secret)
        self.assertEqual(got.secret.reveal(), "nvapi-xyz-1234")

    def test_resolve_reports_missing_without_raising(self) -> None:
        got = resolve_secret("env:NVIDIA_API_KEY", {})
        self.assertFalse(got.present)
        self.assertIsNone(got.secret)
        self.assertEqual(got.source, "env:NVIDIA_API_KEY")


class ParseEnvTests(unittest.TestCase):
    def test_handles_comments_quotes_and_blanks(self) -> None:
        content = "\n".join(
            [
                "# a comment",
                "",
                "NVIDIA_API_KEY = nvapi-123 ",
                'QUOTED="hello world"',
                "SINGLE='single'",
                "NOEQ",
                "=nokey",
            ]
        )
        parsed = parse_env(content)
        self.assertEqual(parsed["NVIDIA_API_KEY"], "nvapi-123")
        self.assertEqual(parsed["QUOTED"], "hello world")
        self.assertEqual(parsed["SINGLE"], "single")
        self.assertNotIn("NOEQ", parsed)
        self.assertNotIn("", parsed)


class RedactTests(unittest.TestCase):
    def test_scrub_masks_registered_values(self) -> None:
        clear_registered_secrets()
        try:
            register_secret_value("nvapi-super-secret-1234")
            register_secret_value("x")  # too short, ignored
            out = scrub_string("key is nvapi-super-secret-1234 ok")
            self.assertNotIn("super-secret", out)
            self.assertIn("****1234", out)
        finally:
            clear_registered_secrets()


class LoadEnvironmentTests(unittest.TestCase):
    def test_real_env_overrides_dotenv_file(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / ".env.local").write_text("NVIDIA_API_KEY=from-file\nONLY_FILE=yes\n")
            merged = load_environment({"NVIDIA_API_KEY": "from-env"}, root)
            self.assertEqual(merged["NVIDIA_API_KEY"], "from-env")  # env wins
            self.assertEqual(merged["ONLY_FILE"], "yes")  # file value available


if __name__ == "__main__":
    unittest.main()
