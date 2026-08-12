# Agent Studio — Workspace Model

> Phase 6
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Agent Studio is **workspace-first**. The workspace is the primary object; the
conversation is an interface into it. This document defines what a workspace is,
how it is opened, configured, governed, remembered, and indexed.

---

## 1. Definition

A **workspace** is a bounded context of real work, rooted in one or more
directories on the local machine. It can be:

- a **software project** / repository,
- a **documentation** repo,
- an **infrastructure/ops** folder,
- a **document collection** / knowledge base,
- a generic **project folder**.

A workspace has: **roots** (allowed directories), **config**, **policy**,
**metadata**, **memory**, an **index**, **sessions**, and an **audit log**.
Everything an agent may read or touch is scoped to the workspace roots.

---

## 2. Open Folder vs Open Workspace

- **Open Folder** — point Agent Studio at a directory. It becomes a single-root
  workspace with sensible defaults inferred from its contents (e.g. git repo →
  enable Git module; presence of code vs docs → suggest a persona template).
  No files are written into the folder unless the user opts in.
- **Open Workspace** — open a saved workspace definition (see §4) that may span
  multiple roots and carries explicit config, policy, and metadata. This is the
  richer, portable object.

**Design principle:** opening a folder is zero-friction and non-invasive;
"upgrading" it into a saved workspace is an explicit, reversible action.

---

## 3. Workspace Storage Layout

Two storage locations, deliberately separated for privacy and portability:

1. **In-workspace (opt-in, shareable):** a `.agentstudio/` directory at the
   workspace root for *shareable, project-scoped* config the user wants to
   commit (e.g. policy defaults, allowed MCP servers, persona template).
   - `.agentstudio/workspace.json` — config & policy (see §4)
   - `.agentstudio/policy.json` — permission policy (may be merged into config)
   - `.agentstudio/rules.md` — project guidance for agents (optional)
2. **App-managed (private, per-machine):** under the OS app-data directory,
   keyed by workspace id, for *private/local* state that must never be committed:
   - session transcripts, audit ledger, index/embeddings, memory, snapshots,
     cached model catalogs, and any secrets references (keys live in the OS
     keychain via Identity Manager, never in files).

Secrets are **never** stored in either the workspace folder or plaintext config.

---

## 4. Workspace Configuration

`workspace.json` (illustrative shape; final schema defined at implementation):

```jsonc
{
  "id": "uuid",
  "name": "Payments Service",
  "roots": ["."],                    // one or more paths, confined
  "type": "software|docs|infra|documents|generic",
  "persona": "engineer|devops|security|writer|analyst|generic",
  "defaultMode": "planning",         // permission mode on open (safe default)
  "provider": { "ref": "account-id", "model": "..." },
  "policy": { /* see policy section below */ },
  "mcpServers": [ /* allowed servers, see mcp-strategy.md */ ],
  "index": { "enabled": true, "include": ["**/*"], "exclude": ["node_modules/**"] },
  "memory": { "enabled": true }
}
```

Config is layered: **app defaults → workspace config → session overrides**, with
the most restrictive permission setting winning (fail-safe).

---

## 5. Workspace Policies

Policy is the workspace-scoped input to the Permission Manager
(`permission-model.md`). It expresses *what agents may do here*, independent of
the transient session mode. Examples:

- **Default permission mode** on open (default: **Planning**, a safe read-mostly
  mode — never Autonomous).
- **Path rules:** writable globs, read-only globs, always-deny globs
  (e.g. deny `.env*`, `**/secrets/**`, `.git/**` writes).
- **Terminal rules:** allow/deny lists, dangerous-command policy, network policy.
- **Git rules:** may the agent commit? push? (push is deny-by-default).
- **MCP rules:** which servers are allowed; per-tool allow/deny.
- **Provider rules:** allowed providers/models (for cost/compliance).
- **Autonomy caps:** max unattended steps, max files touched per action, spend
  caps.

Policy is declarative, human-readable, diffable, and auditable. The **most
restrictive** applicable rule wins; unknown → deny.

---

## 6. Workspace Metadata

Lightweight descriptive data, distinct from policy:

- name, type, persona, created/last-opened timestamps;
- detected characteristics (git? language mix? doc-heavy? size);
- pinned files/folders, tags, description;
- links to related workspaces (future multi-repo).

Metadata drives UX (templates, suggestions) but grants no permissions.

---

## 7. Project Memory

Persistent, workspace-scoped knowledge that improves agent usefulness across
sessions:

- **Facts & decisions** the user or agent captured ("we use pnpm", "prod DB is
  read-only", ADR summaries).
- **Preferences** ("write tests first", "docs in British English").
- **Summaries** of prior sessions and outcomes.

Principles: memory is **user-visible, editable, and deletable**; every write to
memory is an auditable action; memory is *data/context*, never *authority*
(it cannot grant permissions or bypass the gate). Memory lives in app-managed
private storage by default; a user may opt to commit a curated subset via
`.agentstudio/rules.md`.

---

## 8. Workspace Indexing

To ground agents in the workspace without dumping everything into context:

- **What:** file tree, symbol/heading maps, and (optionally) embeddings for
  semantic retrieval.
- **When:** on demand and incrementally on change (watch with debounce);
  respects `.gitignore` and index include/exclude globs.
- **Where:** app-managed private storage; never written into the workspace unless
  opted in.
- **Privacy:** indexing is **local by default**. If embeddings require a remote
  provider, that is an explicit, auditable choice; local-embedding options are
  preferred for privacy-sensitive workspaces.
- **Scale:** cap sizes, chunk large files, skip binaries/build artifacts,
  provide size/time budgets and a visible "what was indexed" view.

Indexing is a **Knowledge Manager** concern (see `core-modules.md`) and is
phased (basic tree/symbol maps first; embeddings/retrieval later per
`roadmap.md`).

---

## 9. Workspace Context (what the agent actually sees)

Context assembly per turn is explicit and budgeted:

1. **System + persona + workspace rules** (`.agentstudio/rules.md`, persona).
2. **Relevant memory** (recalled facts/preferences).
3. **Retrieved workspace content** (from the index, ranked to fit the token
   budget) — file excerpts, symbol/heading maps, open/pinned files.
4. **Session history** (recent turns, tool results).
5. **Current task/prompt.**

Design goals: **transparency** (the user can inspect exactly what context was
sent), **budget-awareness** (respect model context limits and cost), and
**least-context** (send only what's needed). Untrusted file content included as
context is treated as **data, not instructions** (see `security-review.md`,
prompt injection).

---

## 10. Lifecycle Summary

```
Open Folder ──(infer defaults, non-invasive)──▶ Active Workspace
     │                                              │
     └──(explicit, reversible)──▶ Save as Workspace │
                                                    ▼
     Sessions ⇄ Memory ⇄ Index ⇄ Audit  (all scoped to workspace roots)
                                                    │
                                              Close / Export
```

Closing a workspace flushes sessions, memory, and audit to storage. Workspaces
are portable (the shareable `.agentstudio/` subset) while private state stays
local.

---

## 11. Non-Goals for the Workspace Model (v1)

- No cross-machine sync of private workspace state.
- No shared/multiplayer workspaces.
- No cloud-hosted indexing service.
- No automatic remote uploading of workspace content for indexing without
  explicit, auditable consent.
