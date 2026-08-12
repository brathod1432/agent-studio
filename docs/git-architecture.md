# Agent Studio — Git Architecture

> Phase 10
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Git serves two roles in Agent Studio: (1) a first-class capability agents assist
with, and (2) a **reversibility backbone** for agent changes (per Aider's
git-as-undo philosophy). All git *writes* pass the Permission gate and are
audited; **push and history-rewrite are deny-by-default** and destructive.

---

## 1. Design Principles

1. **Read freely, write carefully:** status/diff/log/branch-list are low risk;
   commits are gated; push/rewrite are destructive and always confirmed.
2. **Attribution:** agent-authored commits are clearly attributable (trailer/
   co-author metadata) so history shows what the AI did.
3. **Reversibility:** commits + branches give durable undo for agent work,
   complementing filesystem snapshots (`file-system-architecture.md`).
4. **Safety:** never rewrite shared history, never force-push, never `reset
   --hard` over uncommitted work without explicit, specific confirmation.
5. **No credential handling by the agent:** remote auth uses the user's existing
   git credential setup; the agent never sees or manages tokens.

---

## 2. Supported Capabilities

| Capability | Risk | Default gate |
|---|---|---|
| `status` | Low | allow (read) |
| `diff` (working/staged/commit) | Low | allow (read) |
| `log` / `blame` / `show` | Low | allow (read) |
| Branch list / current | Low | allow (read) |
| `add` / stage / unstage | Medium | Edit+ with approval |
| `commit` | Medium | Agent mode / approval |
| Create / switch branch | Medium | approval |
| `stash` | Medium | approval |
| `restore` / checkout file (safe) | Medium | approval (reversibility) |
| Merge (analysis) | Low (analysis) | allow (read) |
| Merge (apply) | Medium–High | confirm |
| Conflict resolution (propose) | Medium | approval per hunk |
| **`push`** | **High/destructive** | **deny by default; explicit confirm** |
| **Force-push / history rewrite / `reset --hard` / branch delete** | **Destructive** | **explicit per-action confirm; never auto** |

---

## 3. Status, Branches, Diffs, Log

- **Status:** structured view of staged/unstaged/untracked, ahead/behind,
  current branch — surfaced to both agent context and UI.
- **Branches:** list, current, upstream tracking; create/switch are gated writes;
  branch delete is destructive.
- **Diffs:** working-tree, staged, and commit-range diffs; rendered richly in GUI
  (reuse the file diff viewer) and as text in CLI; feed compact diffs to the
  agent to minimize tokens.
- **Log:** commit history with author/date/message; supports blame and show for
  grounding analysis.

---

## 4. Staging & Commits

- Agents propose commits with a **generated message** the user can edit; the
  message focuses on *why*, matching good commit style.
- **Attribution:** agent commits include a machine-readable trailer (e.g.
  `Co-authored-by:` / an `Agent-Studio:` trailer with session id) so the audit
  ledger and git history cross-reference.
- **Commit hooks:** pre-commit hooks are respected; if a hook modifies files or
  fails, the flow surfaces it and re-stages/retries per the platform git rules
  rather than bypassing hooks.
- **Never** `--no-verify`/bypass hooks unless the user explicitly opts in for a
  specific commit.
- Staging granularity: per-file and per-hunk staging supported for precise
  commits.

---

## 5. Reversibility via Git

Git is a primary undo mechanism for git workspaces:

- **Session branch (optional):** agent work can be isolated on a dedicated
  branch/worktree so the main branch is untouched until the user merges —
  clean review and trivial discard.
- **Checkpoint commits:** the agent can create checkpoint commits before risky
  steps; rollback = `restore`/reset to a checkpoint (soft/mixed by default; hard
  reset is destructive and confirmed).
- **Undo agent changes:** revert or restore session-scoped changes using git
  when available, combined with filesystem snapshots for non-committed state.

The user chooses the style (work directly vs on a session branch) per workspace
policy.

---

## 6. Pull Requests / Forge Integration

- **v1:** local git only; **no** direct push or PR creation as a default
  capability. Generating a PR *description* from a diff is allowed (it's just
  text); actually pushing/creating a PR is a destructive, explicit, opt-in action
  and is deferred/limited.
- **Post-v1:** optional forge integrations (GitHub/GitLab/Bitbucket) via **MCP
  servers** rather than baked-in clients, keeping the core provider/forge-neutral
  (`mcp-strategy.md`). PR creation, review, and status remain gated, audited, and
  never auto-push.

---

## 7. Merge Analysis & Conflict Resolution

- **Merge analysis (read/advisory):** the agent can analyze whether a merge is
  clean, summarize incoming changes, and highlight likely conflict areas —
  low-risk, no writes.
- **Conflict resolution (assisted):** on conflicts, the agent proposes
  resolutions **per hunk** as diffs the user reviews and approves; nothing is
  auto-resolved silently. Resolution edits go through the file approval workflow.
- **Apply merge:** performing the merge/commit is a gated write; a conflicted or
  risky merge requires explicit confirmation and is fully audited.

---

## 8. Safety Rules (aligned with platform git rules)

- **Never** update git config automatically.
- **Never** use interactive (`-i`) flows that can't be driven safely.
- **Do not push** unless explicitly requested and confirmed for that action.
- **Do not commit** when there are no changes.
- **Never** force-push, rewrite published history, delete branches, `reset
  --hard`, or checkout over uncommitted changes without explicit, specific
  confirmation — these are destructive per the safety policy.
- The agent never handles remote credentials.

---

## 9. Implementation Notes

- Prefer a robust git library binding over shelling out where practical, for
  structured results and fewer parsing/security pitfalls; fall back to invoking
  the system `git` for operations better handled by it (respecting hooks/config).
- All git writes emit Audit records cross-referencing the git object ids
  (commit/branch) with the session and approval.
- Non-git workspaces rely solely on filesystem snapshots/trash for reversibility;
  the product must be fully usable without git.

---

## 10. Out of Scope (v1)

- Direct push / PR creation as a default capability.
- Non-git VCS (Mercurial, SVN, Perforce).
- Server-side/hosted git operations beyond what MCP forge servers provide later.
- Automated large-scale history rewriting.
