"""Map a manifest ``pipeline`` name to its workflow callable."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ...tools.base import ToolRegistry
from . import code_review, security_audit

# pipeline(registry, target) -> result dict (must include a "report" string)
Pipeline = Callable[[ToolRegistry, str], dict[str, Any]]

_PIPELINES: dict[str, Pipeline] = {
    "code_review": code_review.run,
    "security_audit": security_audit.run,
}


def get_pipeline(name: str) -> Pipeline | None:
    return _PIPELINES.get(name)


def pipeline_names() -> list[str]:
    return sorted(_PIPELINES)
