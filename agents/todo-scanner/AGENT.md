# TODO Scanner

**Workflow:** `pipeline` (deterministic) · **Read-only**

Scans text files under a directory for `TODO`, `FIXME`, `HACK`, and `XXX`
markers and reports each with its file, line number, and note (grouped by
marker). Skips sensitive/binary files.

## Tools (allow-list)
`report.markdown`.

## Safety
Read-only; never edits code.
