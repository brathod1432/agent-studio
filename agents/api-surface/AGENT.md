# API Surface

**Workflow:** `pipeline` (deterministic) · **Read-only**

Maps the public API of a Python package: for each module, the public
(non-underscore) top-level functions and classes (via `code.analyze`), rendered
as a Markdown index.

## Tools (allow-list)
`code.analyze`, `report.markdown`.

## Safety
Read-only; never modifies files.
