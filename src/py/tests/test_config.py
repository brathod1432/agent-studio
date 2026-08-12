from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from agent_studio.config.loader import (
    JsonParseError,
    load_catalog,
    load_default_config,
    load_settings,
    provider_config_from_preset,
    read_json_file,
    resolve_active_provider,
)

NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b"


class CatalogTests(unittest.TestCase):
    def test_loads_nvidia_preset_from_repo_config(self) -> None:
        catalog = load_catalog()
        nvidia = catalog.providers["nvidia"]
        self.assertEqual(nvidia.kind, "openai-compatible")
        self.assertEqual(nvidia.base_url, "https://integrate.api.nvidia.com/v1")
        self.assertEqual(nvidia.api_key_env, "NVIDIA_API_KEY")
        self.assertTrue(nvidia.requires_api_key)
        self.assertEqual(nvidia.default_model, NVIDIA_MODEL)

    def test_default_config_is_data_driven(self) -> None:
        defaults = load_default_config()
        self.assertEqual(defaults.active_provider, "nvidia")
        self.assertEqual(defaults.default_model, NVIDIA_MODEL)
        self.assertGreater(defaults.max_context_tokens, 0)

    def test_provider_config_from_preset_stores_ref_not_key(self) -> None:
        cfg = provider_config_from_preset(load_catalog().providers["nvidia"])
        self.assertEqual(cfg.api_key_ref, "env:NVIDIA_API_KEY")
        self.assertEqual(cfg.model, NVIDIA_MODEL)


class ReadJsonTests(unittest.TestCase):
    def test_read_json_is_bom_safe(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.json"
            p.write_text("\ufeff{\"ok\": true}", encoding="utf-8")
            self.assertEqual(read_json_file(p), {"ok": True})

    def test_read_json_raises_clear_error(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bad.json"
            p.write_text("{ not valid ]", encoding="utf-8")
            with self.assertRaises(JsonParseError):
                read_json_file(p)


class SettingsTests(unittest.TestCase):
    def _write(self, data_dir: Path, obj: object, bom: bool = False) -> None:
        text = json.dumps(obj)
        if bom:
            text = "\ufeff" + text
        (data_dir / "settings.json").write_text(text, encoding="utf-8")

    def test_bom_settings_are_honored_not_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            data_dir = Path(d)
            self._write(
                data_dir,
                {
                    "activeProvider": "ollama",
                    "defaultModel": "llama3.1",
                    "providers": {
                        "ollama": {
                            "id": "ollama",
                            "label": "Ollama",
                            "kind": "openai-compatible",
                            "baseUrl": "http://localhost:11434/v1",
                            "model": "llama3.1",
                        }
                    },
                },
                bom=True,
            )
            settings = load_settings(data_dir=data_dir, warn=False)
            self.assertEqual(settings.active_provider, "ollama")

    def test_malformed_settings_warn_and_fall_back(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            data_dir = Path(d)
            (data_dir / "settings.json").write_text("{ broken,,, }", encoding="utf-8")
            buf = io.StringIO()
            with redirect_stderr(buf):
                settings = load_settings(data_dir=data_dir, warn=True)
            self.assertEqual(settings.active_provider, "nvidia")  # default
            self.assertIn("settings file", buf.getvalue().lower())

    def test_resolve_active_provider_materializes_from_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            settings = load_settings(data_dir=Path(d), warn=False)
            active = resolve_active_provider(settings, load_catalog())
            self.assertIsNotNone(active)
            self.assertEqual(active.id, "nvidia")
            self.assertEqual(active.model, NVIDIA_MODEL)


if __name__ == "__main__":
    unittest.main()
