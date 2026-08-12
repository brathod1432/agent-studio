"""Markdown report generation."""

from __future__ import annotations

from typing import Any

from .base import Tool, ToolError, _require_str


def markdown_report(args: dict[str, Any]) -> dict[str, Any]:
    title = _require_str(args, "title")
    sections = args.get("sections", [])
    if not isinstance(sections, list):
        raise ToolError("'sections' must be a list of {heading, body}.")
    lines: list[str] = [f"# {title}", ""]
    for section in sections:
        if not isinstance(section, dict):
            raise ToolError("Each section must be an object with 'heading' and 'body'.")
        heading = str(section.get("heading", "")).strip()
        body = str(section.get("body", "")).strip()
        if heading:
            lines.append(f"## {heading}")
            lines.append("")
        if body:
            lines.append(body)
            lines.append("")
    markdown = "\n".join(lines).rstrip() + "\n"
    return {"markdown": markdown}


REPORT_MARKDOWN = Tool(
    name="report.markdown",
    description="Build a Markdown report from a 'title' and a list of 'sections' ({heading, body}).",
    input_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "sections": {"type": "array", "items": {"type": "object"}},
        },
        "required": ["title"],
    },
    handler=markdown_report,
)
