# Code Reviewer

**Workflow:** `pipeline` (deterministic — no LLM required) · **Read-only**

Reviews Python source and produces a Markdown report.

## Steps
1. Resolve the input path (a `.py` file, or a directory → all `*.py`, capped).
2. For each file, run `code.analyze` (AST): functions (with arg counts), classes
   (with methods), imports, and line count.
3. Apply heuristics: large files, long functions (many args), classes with many
   methods, modules with no functions/classes, high import fan-out.
4. Render a `report.markdown` with a summary table and per-file findings.

## Tools (allow-list)
`code.analyze`, `fs.summarize`, `report.markdown` — all read-only.

## Safety
Read-only; never writes or executes. `code.analyze` refuses to read sensitive
files (`.env`, keys). Bounded by `maxSteps`.
