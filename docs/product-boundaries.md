# Agent Studio — Product Boundaries

> Phase 3
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

This document draws hard lines: what Agent Studio *is*, what it is *not*, what
ships in v1, what is deferred, and what must never be included.

---

## 1. What Agent Studio IS

- A **standalone, installable desktop application** (Windows, Linux, macOS) with
  a **CLI**, and later an **optional web interface** over the same engine.
- A **workspace-first AI agent environment**: the workspace (folder / repo /
  document collection) is the primary object; conversation is an interface into it.
- A **local-first, provider-agnostic** orchestrator of LLM providers and models.
- A **permissioned action engine**: agents act on files, terminal, git, and MCP
  systems only through a graduated, auditable permission model.
- An **MCP client** for connecting external tools and data sources.
- An **auditable and reversible** system: every consequential action is logged,
  explainable, and undoable wherever technically possible.
- An **open-source project** designed for external contribution.
- A tool for **many professionals** — engineers *and* non-coders.

## 2. What Agent Studio IS NOT

- **Not a general chatbot** detached from a workspace.
- **Not a hosted SaaS / cloud IDE**; no mandatory backend or telemetry.
- **Not a full code editor / IDE** (no language servers, debuggers, refactoring
  engines); it complements editors rather than replacing them.
- **Not a model host / training / fine-tuning platform.**
- **Not a fully autonomous agent swarm** by default; autonomy is opt-in and bounded.
- **Not a team/multiplayer collaboration platform** in early versions.
- **Not a key broker**; user credentials never transit our infrastructure.
- **Not a prompt/agent marketplace** as a core early concern.

---

## 3. What Belongs in v1

The v1 goal: **a trustworthy, single-user, provider-agnostic desktop workspace
agent** that proves the control/audit/reversibility thesis. (See `roadmap.md`
for phasing to v1.0.)

**In v1:**
- Desktop app (primary target platform first) + CLI sharing one local engine.
- Workspace: open folder/repo, workspace config + policy, basic metadata,
  session persistence.
- Providers: a provider abstraction with a first-class set —
  **NVIDIA NIM, OpenAI, Anthropic, Ollama, and generic OpenAI-compatible**;
  API-key entry, connection validation, model discovery.
- Agent engine: single agent, tool-use loop, streaming, plan/act.
- Permission model: **Read-Only, Planning, Edit, Agent** modes enforced at the
  tool boundary (Autonomous/Enterprise deferred/limited).
- File operations: read, create, modify, rename, move, delete — with diff
  preview, approval, and undo (snapshot/trash).
- Terminal: command execution with approval, logging, dangerous-command
  detection.
- Git: status, diff, stage, commit, branch, log (read + safe writes).
- MCP: connect stdio + Streamable HTTP servers; list/allow tools; per-tool
  permission.
- Audit: complete session action ledger, viewable and exportable.
- Settings & secure secret storage (OS keychain).
- Baseline UI (see `ui-research.md`) with diff/approval/audit surfaces.

## 4. What Belongs in Future Versions

- Full multi-platform packaging matrix (EXE/MSI/AppImage/Linux package/macOS
  app/CLI) hardened and signed for all targets.
- Optional web interface.
- Workspace indexing, retrieval, and project memory / knowledge base.
- Workflow manager (repeatable, parameterized, scheduled/triggered runs).
- Multi-agent orchestration (planner/developer/QA/security/docs/etc.).
- Autonomous mode (bounded) and Enterprise mode (policy control plane, SSO,
  centralized audit, org provider governance).
- Additional providers (Gemini, Azure OpenAI, OpenRouter, LM Studio, more).
- Extension/plugin marketplace; signed shareable workflows/agents.
- Deep git-forge integrations (PR review, merge analysis at scale).
- Mobile "review & approve" companion.

## 5. What Should NEVER Be Included

- **Autonomy or destructive actions enabled by default** without explicit,
  scoped user approval.
- **A key/credential broker** or any exfiltration of user keys/files to our
  infrastructure.
- **Mandatory telemetry** or hidden network calls; any telemetry must be opt-in
  and transparent.
- **Silent, unlogged, or unattributable agent actions** — every consequential
  action must be auditable. (Auditability is non-negotiable.)
- **Bypassable permission enforcement** — no "disable all safety" switch that
  removes the audit trail or the approval boundary for consequential actions.
- **Bundled malware/exploit capabilities** or features whose primary purpose is
  offensive security / credential harvesting.
- **Viral/copyleft or non-commercial-only dependencies in the core** that would
  compromise the open-source, commercially-usable licensing goal.
- **Cloud lock-in** that prevents fully local operation.

---

## 6. Boundary Decision Test

When evaluating any proposed feature, it must pass all four:

1. **Workspace-relevant?** Does it serve work grounded in a workspace? If it's
   pure chat, it's out of scope.
2. **Control-preserving?** Does it keep the user in control, auditable, and
   (where possible) reversible? If it erodes control, it's rejected.
3. **Provider-neutral?** Does it avoid locking users to one vendor? If it hard-
   couples a provider, redesign it behind the abstraction.
4. **Local-first-compatible?** Can it work without a mandatory backend? If not,
   it's optional/deferred, never a core requirement.
