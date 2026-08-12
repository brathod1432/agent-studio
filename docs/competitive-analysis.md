# Agent Studio — Competitive Analysis

> Phase 2
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

This analysis is based on public documentation, source code, and architecture
write-ups. Fast-moving details (versions, exact features) should be
re-validated before major decisions.

---

## 1. Landscape Map

| Tool | Form factor | Open source | Provider model | Primary user | Center of gravity |
|---|---|---|---|---|---|
| **Goose** (Block) | Desktop + CLI | Yes (Apache-2.0) | Multi-provider | Developers | MCP-native agent + extensions |
| **OpenCode** | CLI/TUI + Web + Desktop | Yes | Provider-agnostic (AI SDK) | Developers | Client/server coding agent |
| **Claude Code** | CLI/terminal | No (proprietary) | Anthropic | Developers | Agentic terminal coding |
| **Cursor** | Fork of VS Code | No | Multi (cloud-brokered) | Developers | AI-native IDE |
| **Windsurf** | IDE (VS Code-based) | No | Multi (cloud-brokered) | Developers | Agentic IDE ("Cascade") |
| **Aider** | CLI | Yes (Apache-2.0) | Multi | Developers | Git-native pair programmer |
| **Continue** | IDE extension | Yes (Apache-2.0) | Multi | Developers | In-IDE assistant + custom agents |
| **Roo Code** | VS Code extension | Yes | Multi | Developers | Multi-mode autonomous agent |

**Key observation:** every mainstream tool is *coder-first* and, for the polished
ones, *editor- or terminal-bound*. None is a general **workspace-first**
professional environment spanning coders and non-coders with a graduated
permission model and first-class audit. That is Agent Studio's gap to own.

---

## 2. Per-Tool Analysis

### 2.1 Goose (Block)

- **Architecture:** Rust core. Three components — interface, agent (the
  interactive loop), and extensions. Extensions are MCP servers; each runs as an
  isolated process (or in-process for built-ins) over stdio/SSE. Uses the `rmcp`
  Rust SDK and an `ExtensionManager` managing `McpClient` instances.
- **Strengths:** Truly MCP-native; clean extension model; open source (Apache);
  desktop + CLI; strong isolation story (extensions as separate processes);
  provider-flexible.
- **Weaknesses:** Developer-task oriented; permission model is comparatively
  coarse; not workspace-first (no rich workspace object, policy, indexing, or
  audit-report experience); UX aimed at technical users.
- **What to borrow:** MCP-as-extension model; process isolation for tools;
  Rust core for a safe, fast engine.
- **What to improve on:** Workspace-first framing, graduated permissions,
  first-class audit, non-coder UX.

### 2.2 OpenCode

- **Architecture:** Bun/TypeScript core exposing an **HTTP server** (Hono);
  clients (TUI via SolidJS/OpenTUI, Web via SolidJS, Desktop via **Tauri v2**)
  talk to it via a generated SDK over HTTP/SSE. TUI and server run in separate
  threads/processes for responsiveness. Provider-agnostic via the **Vercel AI
  SDK**; any OpenAI-compatible endpoint works. Persistence via Drizzle + SQLite.
  Ships `build` (full access) and `plan` (read-only) agents.
- **Strengths:** Excellent **client/server decoupling** (one engine, many
  frontends — exactly the architecture Agent Studio wants); provider neutrality
  done well; open; multi-interface (TUI/Web/Desktop) from a shared core;
  per-agent permission (plan vs build).
- **Weaknesses:** Coding/TUI-centric; workspace is essentially "the cwd/repo";
  audit and reversibility are not headline features; non-coder UX absent.
- **What to borrow:** **Local engine + typed SDK + multiple thin clients**;
  provider abstraction via an AI-SDK-like layer; plan/build agent split; SSE
  event stream for live UI updates; SQLite for local persistence.
- **What to improve on:** Elevate workspace to a first-class object; add
  graduated permissions, audit, reversibility, and a professional GUI for
  non-coders.

### 2.3 Claude Code

- **Architecture:** Proprietary terminal agent; tight agentic loop with strong
  tool use (file edits, shell, search), plan mode, and MCP client support.
- **Strengths:** Best-in-class agent loop and tool-use ergonomics; plan mode;
  good permission prompting; MCP support.
- **Weaknesses:** Closed source; single-vendor (Anthropic); terminal-only; not a
  general professional workspace; no persistent workspace model or audit export.
- **What to borrow:** Plan mode discipline; crisp per-action approval UX;
  todo/step tracking; concise diffs before apply.
- **What to improve on:** Openness, provider neutrality, GUI, workspace object,
  audit trail, non-coder reach.

### 2.4 Cursor

- **Architecture:** VS Code fork with deep AI integration; agent mode; cloud
  services broker models and provide indexing/features.
- **Strengths:** Polished IDE UX; strong codebase indexing/retrieval; agent mode;
  large user base.
- **Weaknesses:** Closed; editor-bound; coder-only; cloud dependency and data
  concerns for enterprises; provider choice is brokered, not neutral.
- **What to borrow:** Codebase indexing/retrieval quality; inline diff review UX.
- **What to improve on:** Local-first/offline, openness, provider neutrality,
  non-coder workspaces, audit.

### 2.5 Windsurf

- **Architecture:** VS Code-based IDE with an agentic system ("Cascade") that
  plans and executes multi-step tasks with tool use.
- **Strengths:** Smooth agentic flows; good context awareness; polished.
- **Weaknesses:** Closed; editor/coder-bound; cloud-tied; provider brokering.
- **What to borrow:** Multi-step agent flow UX; clear "what the agent is doing
  now" surfacing.
- **What to improve on:** Same as Cursor — openness, neutrality, workspace-first,
  audit, non-coder reach.

### 2.6 Aider

- **Architecture:** Python CLI; **git-native** (each accepted change is a
  commit); repo-map for context; multi-provider; edit formats (diff/whole).
- **Strengths:** Superb git integration (auto-commit, easy revert = built-in
  reversibility); efficient repo mapping; provider-flexible; open.
- **Weaknesses:** CLI-only (no GUI); coder-only; no rich permission model beyond
  confirm-to-apply; not a general workspace.
- **What to borrow:** **Git-as-undo** philosophy; repo-map context building;
  minimal-token edit formats.
- **What to improve on:** GUI, permission graduation, non-code workspaces,
  audit reports.

### 2.7 Continue

- **Architecture:** Open-source IDE extension (VS Code/JetBrains); configurable
  models, context providers, custom agents/slash commands.
- **Strengths:** Open; highly configurable; provider-flexible; in-editor.
- **Weaknesses:** An extension, not a standalone app; coder-only; bound to host
  IDE; limited workspace/permission/audit story.
- **What to borrow:** Config-driven extensibility; context provider abstraction.
- **What to improve on:** Standalone workspace app, permissions, audit, non-coder.

### 2.8 Roo Code

- **Architecture:** Open-source VS Code extension; multiple "modes" (code,
  architect, ask, debug, custom) with per-mode tool permissions; can run
  autonomously with approval settings.
- **Strengths:** **Mode-based permissions** (a close cousin of our graduated
  model); open; multi-provider; per-mode tool allowlists.
- **Weaknesses:** VS Code-bound; coder-only; audit/reversibility not first-class;
  autonomy controls are per-user config rather than a rigorous architectural
  invariant.
- **What to borrow:** **Per-mode tool permissioning** (validates our
  permission-model direction); custom modes.
- **What to improve on:** Standalone app, workspace-first, audit as a core
  guarantee, non-coder personas.

---

## 3. Comparative Dimensions

### 3.1 Security & Permission Models

- **Binary/confirm-to-apply** (Aider, basic tools): approve each edit/command.
  Simple but coarse and fatiguing at scale.
- **Mode-based** (Roo Code, OpenCode plan/build, Claude Code plan): a small set
  of modes with different tool access. Closest to best practice today.
- **Process isolation** (Goose): tools/extensions as separate processes — a good
  containment primitive, orthogonal to permission granularity.
- **Cloud-brokered** (Cursor, Windsurf): trust and data handling largely
  server-side; weaker fit for local-first/enterprise-private needs.

**Gap Agent Studio fills:** a *rigorously specified, graduated* permission model
(Read-Only → Planning → Edit → Agent → Autonomous → Enterprise) enforced as an
**architectural invariant** at the engine's tool boundary — not a per-user
setting that can be quietly disabled — combined with process isolation for
tools.

### 3.2 Workspace Models

- Nearly all competitors equate "workspace" with "the current repo/cwd."
- None treats the workspace as a first-class object with its own config,
  policies, metadata, memory, index, and audit log that persists across sessions
  and is portable.

**Gap Agent Studio fills:** the workspace *is* the product (see
`workspace-model.md`).

### 3.3 UX Patterns

- **Terminal/TUI** (Claude Code, Aider, OpenCode TUI): fast, scriptable, but
  intimidating for non-coders and weak for rich diffs/audit views.
- **In-IDE** (Cursor, Windsurf, Continue, Roo): great for coders, irrelevant for
  non-coders.
- **Desktop GUI** (Goose desktop, OpenCode desktop): the right form factor for a
  broad professional audience — underexploited for non-coding workflows.

**Gap Agent Studio fills:** a professional desktop GUI (plus CLI) designed for
both coders *and* non-coders, with rich diff/approval/audit surfaces.

### 3.4 Architectural Decisions worth adopting

- **Local engine + typed SDK + thin multi-frontend clients** (OpenCode).
- **MCP-native extension model with process isolation** (Goose).
- **Provider abstraction via an AI-SDK-style layer** (OpenCode/Continue).
- **Git-as-reversibility** (Aider).
- **Mode/agent-scoped tool permissions** (Roo Code, OpenCode, Claude Code).
- **Event-stream (SSE)-driven live UI** (OpenCode).

---

## 4. What Agent Studio Should Improve

1. **Workspace as the primary object** — config, policy, memory, index, audit.
2. **Graduated permission model as an invariant** — not a toggle, enforced at the
   tool boundary and always auditable.
3. **First-class auditability** — complete, exportable, human-readable action
   ledger for every session (see `audit-model.md`).
4. **Reversibility by construction** — snapshots + git + trash for undo.
5. **Radical provider neutrality** — including NVIDIA NIM and local models as
   first-class.
6. **Cross-discipline UX** — serve non-coders with workspace templates and
   progressive disclosure, without alienating power users.

## 5. What Agent Studio Should Avoid

- **Editor lock-in** — do not become "yet another VS Code fork/extension."
- **Cloud dependency by default** — no mandatory backend or telemetry.
- **Provider lock-in / brokering** — never route users' keys through our servers.
- **Autonomy-by-default** — never ship dangerous defaults to win demos.
- **Permission fatigue** — avoid modal-per-action; use scoped, batched,
  mode-aware approvals.
- **Monolithic, contribution-hostile code** — keep the core modular and open.
- **Over-scoping v1** — resist shipping all 15 modules at once.

## 6. Market Gaps Identified

- **The non-coder professional** using AI agents on real files/documents with
  control and audit — essentially unserved by polished tools.
- **Regulated/enterprise-private** teams needing local-first + audit + provider
  governance — no strong open option.
- **True provider neutrality including NVIDIA NIM + local models** in a polished
  desktop app — underserved.
- **A single engine with GUI + CLI + optional Web** built on control/audit
  primitives — the closest is OpenCode (coder/TUI-centric); the professional,
  audit-first, cross-discipline version is open.

---

## 7. Strategic Takeaway

Agent Studio should not out-feature Cursor on coding. It should **redefine the
category** from "AI coding assistant" to "**controlled AI workspace for
professionals**," borrowing the best proven architecture (OpenCode's engine/SDK
split, Goose's MCP+isolation, Aider's git-undo, Roo/Claude's mode permissions)
and differentiating on **control, auditability, reversibility, provider
neutrality, and non-coder reach.**
