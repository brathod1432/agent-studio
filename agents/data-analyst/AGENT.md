# Data Analyst

**Workflow:** `agentic` (model-driven tool loop) · **Read-only**

Answers questions over CSV/JSON you provide. The model may call
`data.csv_to_json`, `data.json_query`, and `text.stats` to compute exact values
before answering.

## Usage
```
agent-studio-py agents run data-analyst 'How many rows? @data.csv'
```
Attach data via `@file` (or paste inline). Tool calls are auto-approved because
the allow-listed tools are read-only.

## Safety
Read-only allow-list; bounded by `maxSteps`; `@file` obeys the workspace/secret
guards.
