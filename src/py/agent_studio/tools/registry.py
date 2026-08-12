"""Assemble the default tool registry."""

from __future__ import annotations

from .base import ToolRegistry
from .code_tools import CODE_ANALYZE
from .data_tools import DATA_CSV_TO_JSON, DATA_JSON_QUERY
from .diff_tools import DIFF_UNIFIED
from .fs_tools import FS_SUMMARIZE
from .report_tools import REPORT_MARKDOWN
from .text_tools import TEXT_STATS, TEXT_SUMMARIZE

_ALL = [
    CODE_ANALYZE,
    TEXT_STATS,
    TEXT_SUMMARIZE,
    DATA_CSV_TO_JSON,
    DATA_JSON_QUERY,
    DIFF_UNIFIED,
    REPORT_MARKDOWN,
    FS_SUMMARIZE,
]


def default_registry() -> ToolRegistry:
    registry = ToolRegistry()
    for tool in _ALL:
        registry.register(tool)
    return registry
