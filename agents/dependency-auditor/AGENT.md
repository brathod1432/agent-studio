# Dependency Auditor

**Workflow:** `pipeline` (deterministic — no LLM required) · **Read-only**

Inventories declared dependencies and flags supply-chain risks.

## Steps
1. Parse `pyproject.toml` (`[project].dependencies` + optional groups),
   `package.json` (`dependencies` + `devDependencies`), and `requirements.txt`.
2. Flag **floating/unpinned** specs (`*`, `latest`, bare names, unbounded `^`/`>=`).
3. Render a Markdown report: per-ecosystem inventory + flagged items.

## Tools (allow-list)
`report.markdown` (files are parsed directly by the deterministic pipeline).

## Safety
Read-only; never installs or resolves anything over the network.
