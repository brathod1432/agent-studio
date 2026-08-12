# Agent Studio — Permission Model

> Phase 7
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

The permission model is the heart of the product promise: **the user is always
in control; the AI is never in full control by default.** It is enforced as an
architectural invariant at the engine's single tool boundary (see
`architecture-options.md`, `core-modules.md`).

---

## 1. Core Concepts

- **Mode** — the *transient session posture* selecting a default policy for what
  the agent may do right now (Read-Only … Enterprise). Switching modes is an
  explicit, audited user action.
- **Policy** — the *workspace-scoped rules* (path/terminal/git/mcp/provider) that
  further constrain any mode (`workspace-model.md`).
- **Grant** — a *scoped, revocable exception* the user approves (e.g. "allow
  writes under `src/` for this session", "allow this one command").
- **Action** — any operation an agent attempts (read/write file, run command,
  git op, MCP tool call, provider call).

**Decision function (conceptual):**
```
decision = evaluate(mode, action, target, workspacePolicy, activeGrants, riskClass)
         ∈ { allow, deny, require_approval }
```
Rules: **most restrictive wins**; **unknown → deny (fail-safe)**; **every
decision and its outcome is audited**; **secrets/deny-globs are never overridable
by a mode**.

---

## 2. The Six Modes

Ordered from most restrictive to most permissive. Default on workspace open is
**Planning** (never Autonomous).

### 2.1 Read-Only Mode
- **Allowed:** read files, list dirs, git status/diff/log, read-only MCP tools,
  provider calls (LLM reasoning), produce analysis/answers in chat.
- **Prohibited:** any write — no file create/modify/move/rename/delete, no
  terminal execution, no git writes, no state-changing MCP tools.
- **Approval rules:** none needed (nothing consequential happens).
- **UX:** frictionless; agent answers and explains but cannot change anything.
- **Risk:** **Very low.**
- **Use cases:** exploring an unfamiliar repo, code/document review, research,
  security reading, onboarding.

### 2.2 Planning Mode  *(default)*
- **Allowed:** everything in Read-Only, **plus** the agent produces a concrete
  **plan** and **proposed changes as previews** (diffs, would-run commands,
  intended file ops) — but does **not** apply them.
- **Prohibited:** applying any change without an explicit transition/approval.
- **Approval rules:** the user reviews the plan and either approves individual
  steps (moving them into Edit/Agent execution) or edits/rejects.
- **UX:** "here's exactly what I would do" — diffs and command previews with
  per-item approve. This is the trust-building default.
- **Risk:** **Low** (proposals only).
- **Use cases:** the safe starting posture for any workspace; design/analysis
  before acting.

### 2.3 Edit Mode
- **Allowed:** Read-Only + apply **file changes** (create/modify/move/rename/
  delete) subject to workspace path policy, with **diff preview + approval** per
  change or per approved batch; snapshots taken for undo.
- **Prohibited:** terminal execution and git writes unless separately granted;
  changes outside writable globs; touching deny-globs (secrets, `.git/**`).
- **Approval rules:** each change (or approved batch) is confirmed before apply;
  bulk actions summarized before apply; deletes always confirmed.
- **UX:** review-and-apply loop; one-click undo; clear per-file diffs.
- **Risk:** **Medium** (reversible file changes).
- **Use cases:** focused editing/refactoring, document drafting, config edits.

### 2.4 Agent Mode
- **Allowed:** Edit + **terminal execution** and **git operations**, so the agent
  can carry out multi-step tasks (edit → run tests → iterate), each
  consequential action still gated per policy/risk.
- **Prohibited:** high-risk/destructive actions without explicit confirmation
  (see §4); actions outside policy; push (deny-by-default).
- **Approval rules:** **risk-based** — low-risk reads/commands may auto-proceed
  within granted scopes; medium-risk require approval or a session grant;
  high-risk/destructive **always** require explicit, per-action confirmation.
- **UX:** the agent works with a live action feed; approvals surface inline;
  user can pause/stop; scoped grants reduce fatigue ("allow `pytest` this
  session").
- **Risk:** **Medium–High.**
- **Use cases:** implementing a feature, running an analysis pipeline, executing
  a runbook with human oversight.

### 2.5 Autonomous Mode  *(bounded; post-v1)*
- **Allowed:** Agent-mode capabilities executed across many steps with reduced
  per-step prompting, **within explicit caps**: max steps, max files/action,
  time limit, spend cap, and an allowlist of permitted action classes.
- **Prohibited:** anything outside the pre-approved caps/allowlist; destructive
  actions unless pre-authorized within the bounded scope; push by default.
- **Approval rules:** **up-front bounded authorization** ("run autonomously to
  achieve X, up to N steps / $Y, only within `src/` and `tests/`, no deletes,
  no network"), then the agent proceeds and **checkpoints** for review; it must
  **stop and ask** when it would exceed a cap or hit a high-risk action.
- **UX:** a prominent, always-visible "autonomous run" banner with live progress,
  a hard **Stop**, and a required post-run review of the full audit.
- **Risk:** **High** — hence bounded, opt-in, checkpointed, fully audited.
- **Use cases:** large well-specified batch tasks, long refactors, bulk document
  processing — for experienced users who accept the tradeoff.

### 2.6 Enterprise Mode  *(post-v1)*
- **Not a "more powerful" mode — a governed overlay.** Org-defined policy
  constrains *all* other modes and cannot be loosened by the local user.
- **Allowed:** whatever org policy permits (often a locked subset — e.g.
  Autonomous disabled, specific providers only, mandatory approvals).
- **Prohibited:** disabling audit; exceeding org caps; using non-approved
  providers/models; local override of org deny rules.
- **Approval rules:** may add mandatory reviewers, mandatory logging/retention,
  and centralized audit export; approvals may route to a policy service.
- **UX:** clear "managed by your organization" indicators; blocked actions
  explain the governing policy.
- **Risk:** **Reduces** organizational risk by construction.
- **Use cases:** regulated/enterprise deployments needing governance, compliance,
  and centralized auditability.

---

## 3. Mode Capability Matrix

| Capability | Read-Only | Planning | Edit | Agent | Autonomous | Enterprise |
|---|---|---|---|---|---|---|
| Read files / list | ✅ | ✅ | ✅ | ✅ | ✅ | policy |
| Git read (status/diff/log) | ✅ | ✅ | ✅ | ✅ | ✅ | policy |
| Read-only MCP tools | ✅ | ✅ | ✅ | ✅ | ✅ | policy |
| Propose plan/diffs | — | ✅ | ✅ | ✅ | ✅ | policy |
| Apply file writes | ❌ | ❌ (preview) | ✅ approve | ✅ risk-gated | ✅ bounded | policy |
| Terminal execution | ❌ | ❌ (preview) | ❌* | ✅ risk-gated | ✅ bounded | policy |
| Git writes (commit) | ❌ | ❌ (preview) | ❌* | ✅ approve | ✅ bounded | policy |
| Git push | ❌ | ❌ | ❌ | ❌ default | ❌ default | policy |
| State-changing MCP tools | ❌ | ❌ (preview) | grant | ✅ risk-gated | ✅ bounded | policy |
| Destructive actions (§4) | ❌ | ❌ | confirm | confirm | pre-authorized | policy |

`*` available in Edit only via an explicit scoped grant. "policy" = whatever the
organization allows, always ≤ the corresponding non-enterprise capability.

---

## 4. Risk Classification & Destructive Actions

Every action is assigned a **risk class**; the class raises the approval bar
regardless of mode.

- **Low:** reads, listing, `git status/diff/log`, read-only MCP, idempotent
  informational commands.
- **Medium:** file create/modify, `git add/commit`, non-destructive commands,
  writing within allowed paths.
- **High / Destructive** — **always require explicit, per-action confirmation**
  and are **never auto-approved**, even in Autonomous (unless individually
  pre-authorized in the bounded scope):
  - recursive/forced deletes; deleting non-empty dirs; mass file deletion;
  - `git push`, force-push, history rewrite, branch deletion, `reset --hard`,
    `checkout` over uncommitted changes;
  - commands matching dangerous patterns (`rm -rf`, disk/format, `dd`, fork
    bombs, piping remote scripts to a shell, `sudo`, package global installs);
  - network-egress or credential-touching operations;
  - operations outside workspace roots (generally denied outright).

This mirrors the platform safety rule: **no irreversible destructive operation
without explicit user confirmation for that specific action.**

---

## 5. Grants (reducing fatigue without losing control)

- Grants are **scoped** (path glob, command pattern, MCP tool, or provider) and
  **time-boxed** (this action / this session / until revoked).
- Grants are **auditable** and **revocable** at any time from a visible
  "active permissions" panel.
- Grants can **never** exceed the mode/policy ceiling or override deny-globs and
  destructive-action confirmation.
- Example: in Agent mode, approve "run `pytest` and `npm run build` for this
  session" once, rather than per invocation.

---

## 6. Expected User Experience Principles

1. **Safe default:** Planning mode on open; escalation is explicit.
2. **No silent power:** raising a mode is a deliberate, audited action with a
   clear explanation of new capabilities.
3. **Preview before act:** diffs and command previews are the norm.
4. **One-click stop & undo:** a persistent Stop; file/git reversibility.
5. **Explainability:** every allow/deny/approval states *why* (which rule, which
   risk class).
6. **Visible active permissions:** current mode, grants, and policy are always
   inspectable and revocable.
7. **Least fatigue, most control:** scoped grants and risk-based gating avoid
   modal-per-action while never auto-approving destructive actions.

---

## 7. Enforcement Guarantees (invariants)

- Enforcement lives in the **engine**, not clients; a broken/malicious client
  cannot escalate.
- **No bypass path:** there is no "disable permissions" switch that also removes
  the audit trail or the destructive-action confirmation.
- **Fail-safe:** any ambiguity, error, or unknown target → deny.
- **Everything audited:** the mode at the time, the decision, the rule that
  applied, the approval (who/when), and the outcome are all recorded
  (`audit-model.md`).
