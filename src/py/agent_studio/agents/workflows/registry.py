"""Map a manifest ``pipeline`` name to its workflow callable."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ...tools.base import ToolRegistry
from . import api_surface, code_review, dependency_audit, security_audit, todo_scan

# pipeline(registry, target) -> result dict (must include a "report" string)
Pipeline = Callable[[ToolRegistry, str], dict[str, Any]]

_PIPELINES: dict[str, Pipeline] = {
    "code_review": code_review.run,
    "security_audit": security_audit.run,
    "dependency_audit": dependency_audit.run,
    "todo_scan": todo_scan.run,
    "api_surface": api_surface.run,
}


def get_pipeline(name: str) -> Pipeline | None:
    return _PIPELINES.get(name)


def pipeline_names() -> list[str]:
    return sorted(_PIPELINES)
