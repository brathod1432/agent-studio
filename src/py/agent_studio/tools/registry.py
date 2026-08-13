"""Assemble the default tool registry."""

from __future__ import annotations

from .base import ToolRegistry
from .code_tools import CODE_ANALYZE, CODE_COMPLEXITY
from .data_tools import DATA_CSV_TO_JSON, DATA_INFER_SCHEMA, DATA_JSON_QUERY, DATA_SUMMARIZE_CSV
from .diff_tools import DIFF_UNIFIED
from .fs_tools import FS_SUMMARIZE
from .report_tools import REPORT_MARKDOWN
from .security_tools import SECRETS_SCAN_TEXT
from .text_tools import TEXT_STATS, TEXT_SUMMARIZE

_ALL = [
    CODE_ANALYZE,
    CODE_COMPLEXITY,
    TEXT_STATS,
    TEXT_SUMMARIZE,
    DATA_CSV_TO_JSON,
    DATA_SUMMARIZE_CSV,
    DATA_JSON_QUERY,
    DATA_INFER_SCHEMA,
    DIFF_UNIFIED,
    REPORT_MARKDOWN,
    FS_SUMMARIZE,
    SECRETS_SCAN_TEXT,
]


def default_registry() -> ToolRegistry:
    registry = ToolRegistry()
    for tool in _ALL:
        registry.register(tool)
    return registry
