"""CSV/JSON data transforms (standard library only)."""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from .base import Tool, ToolError, _require_str


def csv_to_json(args: dict[str, Any]) -> dict[str, Any]:
    text = _require_str(args, "csv")
    delimiter = str(args.get("delimiter", ","))[:1] or ","
    has_header = bool(args.get("has_header", True))
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows = [row for row in reader if row]
    if not rows:
        return {"rows": [], "count": 0}
    if has_header:
        header = rows[0]
        records = [dict(zip(header, r)) for r in rows[1:]]
    else:
        records = [{"col%d" % i: v for i, v in enumerate(r)} for r in rows]
    return {"rows": records, "count": len(records)}


def json_query(args: dict[str, Any]) -> dict[str, Any]:
    path = _require_str(args, "path")
    data: Any
    if "data" in args:
        data = args["data"]
    elif isinstance(args.get("json"), str):
        try:
            data = json.loads(args["json"])
        except json.JSONDecodeError as err:
            raise ToolError(f"Invalid JSON: {err}") from err
    else:
        raise ToolError("Provide 'data' (object) or 'json' (string).")

    current = data
    for part in path.split("."):
        if isinstance(current, list):
            if not part.lstrip("-").isdigit():
                raise ToolError(f"Expected a list index at '{part}'.")
            idx = int(part)
            if idx < -len(current) or idx >= len(current):
                raise ToolError(f"Index out of range at '{part}'.")
            current = current[idx]
        elif isinstance(current, dict):
            if part not in current:
                raise ToolError(f"Key not found: '{part}'.")
            current = current[part]
        else:
            raise ToolError(f"Cannot descend into a scalar at '{part}'.")
    return {"value": current}


DATA_CSV_TO_JSON = Tool(
    name="data.csv_to_json",
    description="Parse CSV text ('csv') into JSON rows. Options: delimiter, has_header (default true).",
    input_schema={
        "type": "object",
        "properties": {
            "csv": {"type": "string"},
            "delimiter": {"type": "string"},
            "has_header": {"type": "boolean"},
        },
        "required": ["csv"],
    },
    handler=csv_to_json,
)

DATA_JSON_QUERY = Tool(
    name="data.json_query",
    description="Read a dotted path (e.g. 'a.b.0.c') from a JSON object ('data') or JSON string ('json').",
    input_schema={
        "type": "object",
        "properties": {"data": {}, "json": {"type": "string"}, "path": {"type": "string"}},
        "required": ["path"],
    },
    handler=json_query,
)
