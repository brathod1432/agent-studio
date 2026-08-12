# Agent Studio — Product Vision

> Phase 1: Product Discovery
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

---

## 1. Problem Statement

Knowledge work today is fragmented across dozens of tools, and the current
generation of AI assistants makes this worse, not better:

- **Chat-first tools lose the work.** ChatGPT-style interfaces treat the
  conversation as the primary object. The artifacts that actually matter —
  files, repositories, documents, infrastructure definitions — live somewhere
  else. Context is copied in and out by hand and lost between sessions.
- **Coding-only agents ignore everyone else.** Tools like Cursor, Aider, and
  Claude Code are excellent for software engineers but assume a code editor,
  a language server, and a git repository. Consultants, analysts, SREs,
  security engineers, technical writers, and office workers are left out even
  though their work is equally file- and process-centric.
- **Agents are trusted too much or too little.** Most tools either gate every
  action behind a modal (annoying, unusable at scale) or run fully autonomous
  (dangerous, unauditable). There is no coherent, graduated model of control.
- **Provider lock-in.** Many tools are effectively skins over a single vendor.
  Users cannot bring an NVIDIA NIM endpoint, a local Ollama model, an
  enterprise Azure OpenAI deployment, and a hosted Anthropic key into one
  consistent workspace.
- **No auditability.** In regulated and enterprise environments, "what did the
  AI do, when, with whose approval, and can we undo it?" is unanswerable with
  today's tools. This blocks adoption entirely.

The core unmet need: **a local-first, provider-agnostic, workspace-centric AI
agent environment where every action is transparent, permissioned, auditable,
and reversible — usable by any technical professional, not just coders.**

---

## 2. Product Vision

Agent Studio is a professional **AI Agent Workspace** — a standalone,
installable desktop application in which humans and AI agents collaborate on
real work grounded in a *workspace* (a folder, repository, or document
collection).

The workspace is the primary object. The conversation is an interface *into*
the workspace, not the point of the product. Agents read and reason over the
files, folders, git history, and metadata of the workspace, and they act on it
through a permissioned, auditable set of tools: file operations, terminal
commands, git operations, and MCP-connected external systems.

Agent Studio is the tool a professional opens in the morning, points at the
thing they are working on, and works *alongside* AI for the rest of the day —
with the confidence that they remain in control of every consequential action.

---

## 3. Mission

**Give every technical professional a trustworthy AI collaborator that operates
directly on their real work, under their explicit control, with a complete
record of everything it did.**

Three commitments hold this mission together:

1. **Local-first and open.** Your files, keys, and history stay on your machine.
   The core is open source and inspectable.
2. **Provider-agnostic.** Any LLM provider — cloud, enterprise, or local — is a
   first-class citizen. No lock-in.
3. **Control by design.** Permission, transparency, auditability, and
   reversibility are architectural invariants, not features.

---

## 4. Non-Goals

Agent Studio deliberately does **not** try to be:

- **A general-purpose chatbot.** It is not a place to have open-ended
  conversations detached from a workspace.
- **A hosted SaaS / cloud IDE.** The product is desktop-first and local-first.
  A hosted control plane is at most a much later, optional concern.
- **A replacement for VS Code / JetBrains.** It is not a full code editor with
  language servers, debuggers, and refactoring engines. It complements editors.
- **A model provider or training platform.** It orchestrates models; it does not
  host, fine-tune, or serve them.
- **A fully autonomous "set it and forget it" agent swarm** in v1. Autonomy is
  an opt-in, bounded, auditable mode — never the default.
- **A team collaboration / multiplayer platform** in early versions. Single-user,
  single-machine first; collaboration is a future opportunity.
- **A prompt-marketplace or agent app-store** as a core concern early on.

---

## 5. Target Personas

| Persona | Primary workspace | What they want from agents |
|---|---|---|
| **Software Engineer** | Code repo | Plan, implement, review, refactor, run tests |
| **DevOps / SRE** | Infra repo, ops folder | Analyze configs, draft changes, run safe commands, incident notes |
| **Security Engineer** | Codebase, logs | Audits, threat models, detection rules, dependency review |
| **Technical Architect** | Multi-repo, docs | Design analysis, ADRs, tradeoff docs, diagrams-as-text |
| **Technical PM / TPM** | Docs, trackers | Status reports, planning docs, requirement synthesis |
| **Consultant** | Client doc collection | Deliverable drafting, research synthesis, analysis |
| **Analyst / Researcher** | Data + document folder | Summarization, extraction, structured reporting |
| **Technical Writer** | Docs repo | Draft, edit, restructure, verify against source |
| **Power user / Office worker** | Project folder | Automate repetitive file/document workflows |

**Primary v1 persona:** the individual technical professional working on a
local folder or repo who needs agent help but requires control and a clear audit
trail. Engineers and DevOps/SRE are the sharpest early adopters (they already
live in files, terminals, and git), and serve as the beachhead before expanding
to the broader knowledge-worker audience.

---

## 6. Unique Value Proposition

> **Agent Studio is the only open-source, provider-agnostic desktop workspace
> where AI agents act on your real files, repos, and systems under a graduated
> permission model with a complete, reviewable audit trail.**

The differentiators, in one line each:

- **Workspace-first, not chat-first** — the work is the center of gravity.
- **Everyone, not just coders** — engineers *and* analysts, consultants, writers.
- **Graduated control** — Read-Only → Planning → Edit → Agent → Autonomous →
  Enterprise, not a binary of "ask every time" vs "full auto".
- **Radical provider neutrality** — NVIDIA, OpenAI, Anthropic, Gemini, Azure,
  Ollama, LM Studio, OpenRouter, and any OpenAI-compatible endpoint.
- **Auditable and reversible by construction** — every agent action is logged,
  explainable, and (wherever technically possible) undoable.
- **Local-first and open source** — your data and keys stay on your machine.

---

## 7. Why Existing Tools Are Insufficient

(Full detail in `competitive-analysis.md`.) In brief:

- **Cursor / Windsurf** — closed-source, editor-bound, coder-only, cloud-tied.
- **Claude Code** — excellent agent loop but terminal-only, Anthropic-centric,
  not a general professional workspace.
- **Aider** — powerful CLI pair-programmer, git-centric, coder-only, no GUI, no
  general workspace or permission UX.
- **Continue** — an IDE extension, not a standalone workspace app.
- **Goose** — strong open-source, extensible, MCP-native agent, but oriented to
  developer tasks and lacks a rich workspace-first, permission-graduated,
  audit-first desktop experience for non-coders.
- **OpenCode** — excellent open, provider-agnostic client/server agent, but
  TUI/coding-centric.

None combine: workspace-first design, a graduated permission model, first-class
auditability, radical provider neutrality, *and* a professional cross-discipline
(not coder-only) desktop UX.

---

## 8. Success Metrics

**Adoption & retention**
- Weekly active workspaces (not just installs).
- 4-week retention of users who opened ≥1 workspace.
- Median sessions per active workspace per week.

**Trust & control (the product's core promise)**
- % of consequential actions that pass through the permission layer (target:
  100% — an architectural invariant, measured to prove it).
- % of sessions with a complete, exportable audit log (target: 100%).
- Reversibility coverage: % of file/git actions that are undoable.
- Number of "unexpected/unapproved action" incidents (target: 0).

**Provider neutrality**
- Number of distinct providers used in the wild; share of non-default providers.
- Time-to-first-successful-session after entering a new provider key.

**Ecosystem & open-source health**
- MCP servers connected per active user.
- External contributors, contributor retention, time-to-first-merged-PR.
- Extension/plugin count and install counts.

**Quality**
- Task acceptance rate (proposed diffs/commands accepted vs rejected).
- Crash-free session rate; agent-loop error rate.

---

## 9. Long-Term Product Direction

1. **Phase A — Trustworthy single-user workspace agent** (v0.x → v1.0): the
   solid, auditable, provider-agnostic desktop foundation.
2. **Phase B — Workspace intelligence**: indexing, project memory, retrieval,
   knowledge base over the workspace.
3. **Phase C — Automation & workflows**: repeatable, parameterized,
   permission-bounded multi-step workflows; scheduled/triggered runs.
4. **Phase D — Multi-agent orchestration**: specialized agents (planner,
   developer, QA, security, docs) coordinated under the same control model.
5. **Phase E — Team & enterprise**: shared policies, centralized audit,
   SSO/identity, org-level provider governance, optional collaboration.

---

## 10. Future Opportunities

- Enterprise policy control plane (fleet-wide permission and audit governance).
- Workflow marketplace and shareable, signed agent/workflow templates.
- Domain packs (security auditing, SRE runbooks, consulting deliverables).
- Optional web interface backed by the same local engine (client/server split).
- Mobile "review & approve" companion for pending agent actions.
- Deep git-forge integrations (PR review agents, merge analysis).
- On-device/local-model optimization for privacy-critical environments.

---

## 11. Risks

| Risk | Description | Early mitigation |
|---|---|---|
| **Scope explosion** | 15 modules, 6 personas, 6 platforms is enormous | Ruthless v1 scoping (see `product-boundaries.md`, `roadmap.md`) |
| **Trust failure** | One destructive, unapproved action destroys credibility | Permission + audit + reversibility as architectural invariants |
| **Security surface** | Local FS + terminal + arbitrary MCP + LLM = large attack surface | Threat model up front (`security-review.md`); deny-by-default |
| **Prompt injection** | Malicious file/repo content hijacks the agent | Content is untrusted data; actions still gated by permission layer |
| **Provider churn** | APIs and model catalogs change constantly | Provider abstraction layer; capability negotiation |
| **Crowded market** | Many well-funded competitors | Win on control/audit/neutrality + non-coder reach, not features |
| **Non-coder UX gap** | Serving both engineers and office workers is hard | Progressive disclosure; workspace templates per persona |
| **OSS sustainability** | Maintainer burnout, unclear governance | Modular architecture, contribution-friendly design, clear licensing |
| **Desktop packaging** | 6 targets (EXE/MSI/AppImage/pkg/macOS/CLI) is heavy | Choose a framework with strong cross-platform packaging (see desktop-strategy.md) |

---

## 12. Constraints

- **Local-first**: must function with no backend and no telemetry by default.
- **Open source**: license and dependencies must support an open, contributable
  project; avoid copyleft/viral or non-commercial dependencies in the core.
- **Cross-platform**: Windows, Linux, macOS as first-class; CLI everywhere;
  optional web later.
- **Security & privacy**: keys and data never leave the machine except to the
  provider/MCP endpoints the user explicitly configured.
- **Control invariant**: the AI is never in full control by default; every
  consequential action is transparent, auditable, and reversible where possible.
- **Resource-conscious**: must run acceptably on typical professional laptops.
- **No irreversible action without explicit, scoped user approval.**
