# Agent Studio — File System Architecture

> Phase 8
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

The File Manager gives agents controlled, auditable, reversible access to the
workspace filesystem. Every operation flows through the Permission gate and the
Audit ledger (`permission-model.md`, `audit-model.md`).

---

## 1. Design Principles

1. **Confinement:** all paths resolve to within the workspace roots; symlink/
   traversal escapes (`..`, absolute paths, junctions) are rejected.
2. **Preview then apply:** consequential changes are computed as a diff/plan and
   shown before they touch disk.
3. **Reversibility first:** every mutating operation is undoable via snapshots
   and a workspace trash; deletes are soft by default.
4. **Atomicity:** writes are atomic (write-temp-then-rename) to avoid partial/
   corrupt files; batches are transactional where feasible.
5. **Least privilege:** deny-globs (secrets, `.git/**`, build artifacts) are
   never writable by an agent regardless of mode.
6. **Everything audited:** operation, target(s), before/after hash, size, and
   approving user/time are recorded.

---

## 2. Supported Operations

| Operation | Description | Default gate | Reversible via |
|---|---|---|---|
| **Read** | Read file / list dir / stat | Low risk | n/a |
| **Create** | New file/dir | Medium; preview | delete new file |
| **Modify** | Edit existing file | Medium; diff preview | snapshot restore |
| **Rename** | Change name in place | Medium; preview | inverse rename |
| **Move** | Relocate within roots | Medium; preview | inverse move |
| **Delete** | Remove file/dir | High; confirm | trash restore |
| **Bulk** | Multi-file batch of the above | Summarized preview + confirm | batch snapshot |

Reads honor `.gitignore`/index excludes for context but can be explicitly
requested. Binary/large files are handled specially (see §7).

---

## 3. Edit Representation

- **Diff-based edits** are the primary representation (unified diff / structured
  find-replace with surrounding context), which keeps token usage low and makes
  previews precise (approach validated by Aider/Claude Code).
- **Whole-file writes** are supported for new files or large rewrites, but always
  shown as a diff against current content before apply.
- Edits must match current file content (hash/precondition check); if the file
  changed since the agent read it, the edit **fails safe** and re-reads rather
  than clobbering.

---

## 4. Approval Workflow

```
Agent proposes change ──▶ Compute diff/plan ──▶ Permission check (mode/policy/risk)
        │                                              │
        │                              allow ──────────┤
        │                          require_approval ───┼─▶ User reviews diff ─▶ approve / edit / reject
        │                                   deny ──────┘
        ▼
   On approve: snapshot ──▶ atomic apply ──▶ audit record ──▶ show result + undo affordance
```

- In **Planning** mode the workflow stops at "review diff" (never applies).
- In **Edit/Agent** modes, approved changes apply; low-risk within granted scopes
  may auto-apply, but **deletes and destructive/bulk ops always confirm**.
- Batches present a **single summarized review** (N files, +X/−Y lines, list of
  deletes) with expandable per-file diffs, then apply transactionally.

---

## 5. Snapshots, Undo & Rollback

Three complementary mechanisms:

1. **Operation snapshots (always):** before any mutating op, capture the prior
   state of affected paths (content + metadata) into app-managed private storage.
   Enables per-operation **Undo** even for non-git workspaces.
2. **Workspace Trash (soft delete):** deletes move files to a workspace trash
   with metadata for **Restore**; hard delete/purge is a separate, explicit,
   confirmed action.
3. **Git integration (when available):** for git workspaces, changes can also be
   grouped into commits/branches for durable, familiar reversibility (see
   `git-architecture.md`). Git and snapshots are complementary, not exclusive.

**Undo model:**
- **Undo last operation** — inverse of the most recent mutating op.
- **Undo session** — revert all agent file changes in a session (via snapshots
  and/or `git restore` of session-scoped changes).
- **Rollback to checkpoint** — named restore points the user can create before a
  risky task; restoring reverts all tracked paths to that checkpoint.

Undo/rollback are themselves audited actions.

---

## 6. Diff Viewing (UX)

- Rich side-by-side and inline unified diffs in the GUI; syntax-aware where
  possible; text diff in the CLI.
- Per-hunk accept/reject in Edit mode.
- Bulk-change summary view with aggregate stats and a prominent, separated list
  of **deletions** and **out-of-writable-path** attempts (the latter blocked).
- For renames/moves: show old → new path clearly; detect rename vs delete+create.

---

## 7. Binary, Large, and Special Files

- **Binary files:** not diffed as text; show metadata (type, size, hash) and
  treat writes as whole-file replacements with explicit confirmation.
- **Large files:** enforce configurable size thresholds; stream rather than load
  fully; warn before including in context or rewriting wholesale.
- **Symlinks/junctions:** resolved and validated against roots; escaping links
  are refused.
- **Permission/ownership:** preserve file mode/attributes on modify; never
  silently change executability or ownership.

---

## 8. Confinement & Safety Rules

- Path resolution canonicalizes and verifies the result is inside a workspace
  root; anything else → deny (audited).
- **Deny-globs** (never writable by agent): `.env*`, `**/secrets/**`, `.git/**`,
  keychains/credential files, and user-configured entries.
- Writes outside writable globs are blocked even in Agent/Autonomous mode.
- **Concurrency:** file locks / preconditions prevent races between agent ops and
  external editors; conflicting external changes cause a safe re-read.
- **No follow-symlink-out, no device files, no writing to system paths.**

---

## 9. Failure & Recovery

- Atomic writes ensure a crash mid-apply leaves either the old or new file, never
  a corrupt hybrid.
- If a batch fails partway, already-applied members are rolled back via snapshots
  (best-effort transaction) and the failure is reported and audited.
- Trash and snapshots have retention/quota policies with a visible "storage used
  by undo history" control and safe purge.

---

## 10. Out of Scope (v1)

- Cross-workspace or out-of-root file operations.
- Real-time collaborative editing / OT/CRDT.
- Virtual/remote filesystems (SFTP, cloud drives) — possible future via MCP.
- Full VCS beyond git.
