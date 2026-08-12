# Agent Studio — Roadmap

> Phase 19
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Phased plan from first prototype to a mature platform. Each version is defined by
a **theme**, an **exit bar**, and explicit **in/out of scope**. The invariants —
permission gate, audit, reversibility, local-first, provider neutrality — hold
from v0.1 onward and are never traded away for velocity.

---

## v0.1 — "Trust Skeleton" (Internal Prototype)
**Theme:** prove the control loop end-to-end on one platform, one stack.

- Engine + CLI over the typed SDK; one desktop platform (dev target).
- Open folder → single-root workspace; safe defaults; Planning mode default.
- One provider path: **generic OpenAI-compatible** (covers OpenAI + NVIDIA NIM +
  local Ollama/LM Studio via base URL).
- Agent loop with tool calls behind the **permission gate**.
- File ops: read/create/modify with **diff preview + approval + snapshot undo**.
- **Audit ledger** (append-only) + basic action feed.
- Secret storage via OS keychain.

**Exit bar:** an agent can read a repo, propose a diff, get approval, apply it,
and the whole thing is fully audited and undoable. No action bypasses the gate.

**Out:** GUI polish, multiple providers, terminal/git writes, MCP, packaging.

---

## v0.2 — "Workspace & Providers" (Early Alpha)
**Theme:** the workspace-first experience + real provider neutrality + terminal.

- Desktop **GUI** (Tauri + web-tech UI) with workspace explorer, diff/approval,
  action feed, provider config.
- Provider Manager with first-class **NVIDIA, OpenAI, Anthropic, Ollama,
  OpenAI-compatible**; validation + model discovery; per-workspace defaults.
- **Terminal execution** with approval, risk classification, logging (Agent mode).
- Full file ops incl. rename/move/delete with **trash** + bulk approval.
- Read-Only / Planning / Edit / Agent modes implemented + capability matrix.
- Workspace config/policy (`.agentstudio/`), session persistence.

**Exit bar:** a user configures NVIDIA in <1 min, opens a workspace, and safely
completes an edit-and-run task with full audit and undo.

**Out:** MCP, git writes hardening, indexing, autonomy, multi-platform packaging.

---

## v0.5 — "Connected & Reversible" (Beta)
**Theme:** git, MCP, and reversibility hardened; broaden platforms.

- **Git Manager:** status/diff/log/branch + gated commit/stage + git-based undo;
  attribution trailers; push deny-by-default.
- **MCP Manager:** connect stdio + Streamable HTTP servers; per-tool allowlists;
  gated + audited calls; a few vetted defaults.
- Reversibility: checkpoints, session-undo, rollback across snapshots + git.
- Knowledge Manager v1: file-tree/symbol/heading maps (retrieval basic).
- Packaging for the primary desktop platforms; signed builds + auto-update;
  CLI shipped on all platforms.
- Cost/usage accounting + budget caps; fallback models.
- Security: hardened classifier, per-platform sandboxing, SBOM, dependency scans.

**Exit bar:** external beta users run real multi-step tasks across code/docs/infra
workspaces with git + MCP, and can always review and undo.

**Out:** Autonomous mode, Enterprise, multi-agent, full indexing/embeddings, web.

---

## v1.0 — "Trustworthy Workspace Agent" (GA)
**Theme:** the polished, secure, provider-agnostic single-user workspace agent.

- All six deliverable targets hardened: **Windows EXE + MSI, Linux AppImage +
  package, macOS app, CLI**; signing + notarization on all.
- Modes Read-Only → Agent fully hardened; grants UX; visible active-permissions
  panel; explainable decisions.
- Robust audit: reports/exports (MD/HTML/PDF/JSON/CSV), integrity verification,
  change manifests.
- Provider set stable incl. NVIDIA hosted + **self-hosted NIM**; capability
  negotiation; reliable streaming/tool-calling.
- MCP: stdio + HTTP stable; secret injection from keychain; vetted default set.
- Knowledge Manager: local indexing + retrieval (embeddings optional, local-first).
- Accessibility (WCAG AA target), i18n scaffolding, docs, onboarding templates
  per persona.
- **External security audit** completed; coordinated disclosure policy live.

**Exit bar:** a professional (coder or non-coder) can install, configure any
provider, work all day on a real workspace with agents, and trust that every
action was controlled, audited, and reversible.

**Out (deliberately):** Autonomous (bounded), Enterprise, multi-agent, web,
workflows, marketplace.

---

## v2.0 — "Automation, Orchestration & Enterprise" (Platform)
**Theme:** scale from personal tool to team/enterprise platform.

- **Autonomous mode (bounded):** caps, allowlists, checkpoints, spend limits,
  mandatory post-run review.
- **Multi-agent orchestration:** supervised Planner + Developer + QA/Security +
  Docs, per-agent scoped permissions, full attribution (`multi-agent-strategy.md`).
- **Workflow Manager:** repeatable, parameterized, scheduled/triggered runs.
- **Enterprise mode:** org policy control plane, SSO/identity, centralized +
  signed audit / SIEM export, provider governance, managed deny rules.
- **Optional web interface** over the local engine (self-hosted).
- **Extension/MCP marketplace** with signing/vetting; provider/tool ecosystem.
- Deeper git-forge integrations (PR review, merge analysis at scale) via MCP.
- Additional providers (Gemini, Azure, OpenRouter, more) fully first-class.
- Container/VM execution backend; guardrail integrations.

**Exit bar:** teams deploy Agent Studio under central governance with autonomous
and multi-agent workflows, and every action across the fleet is auditable.

---

## Cross-Version Principles

- **Invariants first:** never ship a version that weakens the permission/audit/
  reversibility guarantees to hit a date.
- **Vertical slices:** each version is usable end-to-end for a real task, not a
  pile of half-features.
- **Keep the seams:** built-in tools/providers implemented behind the same
  interfaces the extension system will use, so later extraction is mechanical.
- **Dogfood:** the team uses Agent Studio to build Agent Studio from v0.2.
- **Community from v0.5:** open contribution, clear governance, good first issues.

---

## Sequencing Rationale

1. **Trust before breadth** (v0.1–v0.2): prove control/audit/undo before adding
   surface area — it's the differentiator and the hardest thing to retrofit.
2. **Connectivity before autonomy** (v0.5): git + MCP + reversibility must be
   solid before letting the agent do more on its own.
3. **Polish + security before GA** (v1.0): packaging, a11y, and an external audit
   gate the 1.0 promise.
4. **Autonomy/enterprise last** (v2.0): highest-risk, highest-complexity features
   ride on a proven, hardened foundation.
