# Agent Studio — Core Modules

> Phase 5
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Modules of the engine (modular-monolith core + plugin layer, per
`architecture-options.md`). Each module has a single responsibility, a published
interface, and explicit dependencies. Cross-module access is only via published
interfaces; the **Permission** and **Audit** modules sit on the critical path of
every consequential action.

---

## 1. Module Map

```
                         ┌───────────────────────┐
                         │      Agent Engine     │
                         └───────────┬───────────┘
                                     │ requests tool calls
                         ┌───────────▼───────────┐
                         │   Permission Manager  │  ← policy gate (invariant)
                         └───────────┬───────────┘
                                     │ (allow / deny / needs-approval)
                         ┌───────────▼───────────┐
                         │      Audit System     │  ← records every action
                         └───────────┬───────────┘
        ┌───────────┬────────────┬───┴────┬────────────┬───────────┐
        ▼           ▼            ▼        ▼            ▼           ▼
   File Manager  Terminal    Git Mgr   MCP Mgr    Provider Mgr  Knowledge
                 Manager                          (LLM calls)    Manager
        └──────────────── all scoped to the active ─────────────────┘
                          Workspace (Workspace Manager)

  Supporting: Session Mgr • Settings Mgr • Identity Mgr • Extension Mgr •
              Workflow Mgr
```

---

## 2. Modules

### 2.1 Workspace Manager
- **Responsibility:** Open/close workspaces; hold workspace config, policy,
  metadata; scope all file/terminal/git access to workspace root(s).
- **Key interfaces:** `openWorkspace(path)`, `getPolicy()`, `getRoots()`,
  `getMetadata()`, `resolvePath()` (rejects escapes outside roots).
- **Depends on:** Settings, Audit. **Detail:** `workspace-model.md`.

### 2.2 Provider Manager
- **Responsibility:** Register/validate LLM providers; list models; make
  chat/completion/tool-call requests; handle auth, retries, fallback, cost/token
  accounting.
- **Key interfaces:** `listProviders()`, `validate(provider)`, `listModels()`,
  `chat(request, stream)`, `capabilities(model)`.
- **Depends on:** Identity (keys), Settings, Audit. **Detail:**
  `provider-architecture.md`, `nvidia-strategy.md`.

### 2.3 Session Manager
- **Responsibility:** Create/persist/resume agent sessions; message history,
  tool-call transcript, token/cost usage; link session ↔ workspace ↔ audit.
- **Key interfaces:** `newSession(workspace)`, `append(event)`,
  `resume(id)`, `list()`, `export(id)`.
- **Depends on:** Workspace, Audit, storage (SQLite).

### 2.4 Agent Engine
- **Responsibility:** The interactive loop — build context, call provider, parse
  tool calls, request tool execution *through the permission gate*, feed results
  back, stream output. Enforces the active permission mode's behavior (e.g.
  Planning mode proposes but does not execute writes).
- **Key interfaces:** `run(prompt, mode)`, `stop()`, `stepEvents()`.
- **Depends on:** Provider, Permission, Audit, Session, all tool modules.
- **Detail:** `multi-agent-strategy.md` (single agent in v1).

### 2.5 Permission Manager  *(security invariant)*
- **Responsibility:** Given (mode, action, target, context), decide
  allow / deny / require-approval; enforce mode rules; manage scoped grants
  (e.g. "allow writes under `src/` this session"); never bypassable.
- **Key interfaces:** `check(action)`, `requestApproval(action)`,
  `grant(scope)`, `revoke(scope)`, `currentMode()`.
- **Depends on:** Workspace policy, Audit. **Detail:** `permission-model.md`.

### 2.6 Audit System  *(security invariant)*
- **Responsibility:** Append-only, tamper-evident ledger of every user and agent
  action, approval, tool call, file/terminal/git/MCP operation, and result;
  produce human-readable reports and exports.
- **Key interfaces:** `record(event)`, `query(filter)`, `report(session)`,
  `export(format)`.
- **Depends on:** storage. **Detail:** `audit-model.md`.

### 2.7 Git Manager
- **Responsibility:** Status, diff, branch, log, stage, commit, and safe write
  operations; provide git-based reversibility for agent changes.
- **Key interfaces:** `status()`, `diff()`, `stage()`, `commit()`, `branch()`,
  `log()`, `restore()`. **Detail:** `git-architecture.md`.

### 2.8 Terminal Manager
- **Responsibility:** Execute commands with approval, streaming output, timeouts,
  environment scoping, dangerous-command detection, full logging.
- **Key interfaces:** `run(cmd, opts)`, `classifyRisk(cmd)`, `history()`.
- **Depends on:** Permission, Audit, Workspace. **Detail:**
  `terminal-architecture.md`.

### 2.9 File Manager
- **Responsibility:** Read, create, modify, rename, move, delete files; bulk
  actions; diff generation; snapshot/undo; path confinement to workspace roots.
- **Key interfaces:** `read()`, `write()`, `move()`, `rename()`, `delete()`,
  `diff()`, `snapshot()`, `undo()`. **Detail:** `file-system-architecture.md`.

### 2.10 Workflow Manager  *(post-v1)*
- **Responsibility:** Define/run repeatable, parameterized, permission-bounded
  multi-step workflows; scheduling/triggers; run history.
- **Key interfaces:** `define()`, `run()`, `schedule()`, `runs()`.
- **Depends on:** Agent, Permission, Audit.

### 2.11 Settings Manager
- **Responsibility:** App- and workspace-level settings; defaults; migration;
  import/export; validation.
- **Key interfaces:** `get()`, `set()`, `scope(app|workspace)`.

### 2.12 Identity Manager
- **Responsibility:** Secure storage of provider API keys and secrets via OS
  keychain (Keychain / DPAPI / libsecret); redaction; per-workspace key scoping;
  never logs secrets.
- **Key interfaces:** `storeKey()`, `getKey()`, `listAccounts()`, `redact()`.
- **Detail:** `security-review.md`.

### 2.13 Extension Manager
- **Responsibility:** Discover, install, sandbox, permission, and lifecycle-manage
  extensions (tools, providers, UI panels); enforce declared-permission model.
- **Key interfaces:** `install()`, `enable()`, `permissionsOf()`, `sandbox()`.

### 2.14 MCP Manager
- **Responsibility:** Connect MCP servers (stdio, Streamable HTTP); discover
  tools/resources/prompts; route agent tool calls to servers through the
  permission gate; process isolation and health management.
- **Key interfaces:** `connect(server)`, `listTools()`, `call(tool, args)`,
  `disconnect()`. **Detail:** `mcp-strategy.md`.

### 2.15 Knowledge Manager  *(phased)*
- **Responsibility:** Index the workspace; retrieval/embeddings; project memory;
  knowledge base grounding for agents.
- **Key interfaces:** `index()`, `query()`, `remember()`, `recall()`.
- **Detail:** `workspace-model.md`.

---

## 3. Dependency Rules

1. **Nothing bypasses Permission + Audit** to perform a consequential action.
2. **Tool modules** (File, Terminal, Git, MCP) never call providers directly and
   never make policy decisions; they *request* via Permission and *report* to
   Audit.
3. **Clients** call only the engine's published SDK; they hold no policy.
4. **Extensions** depend only on stable extension-API interfaces and declare
   required permissions.
5. **Identity** is the only holder of secrets; other modules receive scoped,
   redacted access.
6. Dependencies flow **downward** (Agent → tools), never upward; no cycles.
   Enforce with architecture tests in CI.

---

## 4. Module Maturity by Version (summary; see `roadmap.md`)

| Module | v0.x | v1.0 | Post-v1 |
|---|---|---|---|
| Workspace, Provider, Session, Agent | core | hardened | multi-agent |
| Permission, Audit | core (invariant) | hardened | enterprise policy |
| File, Terminal, Git | core | hardened | advanced (merge, bulk) |
| MCP | basic (stdio) | stdio + HTTP | rich ecosystem |
| Identity, Settings | core | hardened | org identity/SSO |
| Extension | seams only | basic | marketplace |
| Knowledge | — | basic index | full retrieval/memory |
| Workflow | — | — | full |
