from __future__ import annotations

import json
import unittest

from agent_studio.config.types import ProviderConfig, RequestSettings
from agent_studio.providers.diagnostics import format_error, format_health_report
from agent_studio.providers.errors import ProviderError
from agent_studio.providers.testing import health_check, list_models, validate_model
from tests.fakes import FakeResponse, make_http_open

REQUEST = RequestSettings(timeout_ms=50, max_retries=0, retry_base_delay_ms=1)
KEYED_ENV = {"NVIDIA_API_KEY": "nvapi-test-key-abcd1234"}


def nvidia_config() -> ProviderConfig:
    return ProviderConfig(
        id="nvidia",
        label="NVIDIA",
        kind="openai-compatible",
        base_url="https://integrate.api.nvidia.com/v1",
        model="nvidia/model",
        api_key_ref="env:NVIDIA_API_KEY",
    )


def models_json(ids: list[str]) -> str:
    return json.dumps({"data": [{"id": i} for i in ids]})


class ListModelsTests(unittest.TestCase):
    def test_returns_ids_and_sends_bearer(self) -> None:
        http, calls = make_http_open([FakeResponse(200, models_json(["a/m", "b/m"]))])
        models = list_models(nvidia_config(), KEYED_ENV, REQUEST, http)
        self.assertEqual([m.id for m in models], ["a/m", "b/m"])
        self.assertTrue(calls[0]["url"].endswith("/models"))
        self.assertEqual(calls[0]["headers"]["Authorization"], "Bearer nvapi-test-key-abcd1234")

    def test_maps_401_to_invalid_api_key(self) -> None:
        http, _ = make_http_open([FakeResponse(401, "nope")])
        with self.assertRaises(ProviderError) as ctx:
            list_models(nvidia_config(), KEYED_ENV, REQUEST, http)
        self.assertEqual(ctx.exception.kind, "invalid_api_key")


class ValidateModelTests(unittest.TestCase):
    def test_detects_present_absent_unverifiable(self) -> None:
        from agent_studio.providers.testing import ModelInfo

        self.assertEqual(validate_model("m", [ModelInfo("m")]).status, "ok")
        self.assertEqual(validate_model("m", [ModelInfo("other")]).status, "warn")
        self.assertEqual(validate_model("m", []).status, "warn")
        self.assertEqual(validate_model("", [ModelInfo("m")]).status, "error")


class HealthCheckTests(unittest.TestCase):
    def test_ok_when_model_present(self) -> None:
        http, _ = make_http_open([FakeResponse(200, models_json(["nvidia/model"]))])
        report = health_check(nvidia_config(), KEYED_ENV, REQUEST, http)
        self.assertEqual(report.overall, "ok")
        self.assertEqual(report.api_key_masked, "****1234")
        self.assertIn("Overall:   OK", format_health_report(report))

    def test_warn_when_model_missing(self) -> None:
        http, _ = make_http_open([FakeResponse(200, models_json(["other/model"]))])
        report = health_check(nvidia_config(), KEYED_ENV, REQUEST, http)
        self.assertEqual(report.overall, "warn")

    def test_error_on_missing_key(self) -> None:
        http, calls = make_http_open([FakeResponse(200, models_json(["nvidia/model"]))])
        report = health_check(nvidia_config(), {}, REQUEST, http)
        self.assertEqual(report.overall, "error")
        self.assertEqual(len(calls), 0)  # never reached the network
        self.assertEqual(report.api_key_masked, "(not set)")

    def test_error_on_401(self) -> None:
        http, _ = make_http_open([FakeResponse(401, "unauthorized")])
        report = health_check(nvidia_config(), KEYED_ENV, REQUEST, http)
        self.assertEqual(report.overall, "error")

    def test_format_error_is_secret_safe(self) -> None:
        err = ProviderError("invalid_api_key", "Authentication failed (HTTP 401).", status=401)
        out = format_error(err)
        self.assertIn("What to do:", out)


if __name__ == "__main__":
    unittest.main()
