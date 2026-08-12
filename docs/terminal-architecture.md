# Agent Studio — Terminal Architecture

> Phase 9
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Terminal execution is the highest-risk capability in the product. This design
makes it powerful for real work while keeping it approval-gated, logged,
risk-classified, and (where possible) contained.

---

## 1. Design Principles

1. **Never silent:** no command runs without passing the Permission gate and
   being recorded in the Audit ledger.
2. **Risk-aware:** every command is classified; dangerous commands always require
   explicit, per-command confirmation and are never auto-approved.
3. **Scoped:** commands run with the working directory confined to workspace
   roots and an explicit, minimal environment.
4. **Observable:** full command line, cwd, env deltas, exit code, duration, and
   captured output are logged and shown live.
5. **Interruptible:** every run has a hard Stop/kill and a timeout.
6. **Contained where feasible:** sandboxing/isolation applied per platform
   capability (§6).

---

## 2. Terminal Access Model

- The agent does **not** get a raw, persistent, unrestricted shell by default.
  It requests **discrete command executions** (command + args + cwd + options),
  each individually gated.
- A **user-driven interactive terminal** panel exists for the *human* to run
  commands directly; agent-initiated commands are visually distinguished and
  separately audited.
- Persistent shell sessions (for state like activated venvs) are supported as an
  explicit, scoped capability, but each agent command in that session is still
  classified and gated; the session's accumulated state is shown to the user.

---

## 3. Execution Pipeline

```
Agent requests command
   │
   ├─▶ Normalize (resolve cwd ∈ roots, build minimal env, parse argv)
   ├─▶ Risk classify (see §5)
   ├─▶ Permission check (mode + workspace policy + risk + grants)
   │        deny ─────────▶ blocked + audited (explain why)
   │        require_approval ─▶ user approves/edits/rejects (with preview)
   │        allow ──────────▶ proceed
   ├─▶ Execute (sandbox/isolation per §6, timeout, resource caps)
   ├─▶ Stream stdout/stderr live to UI; capture for transcript
   └─▶ Record result (exit code, duration, output hash) in Audit
```

---

## 4. Command Approval

- **Preview:** before running, show the exact resolved command, cwd, and any
  environment differences from the user's shell.
- **Mode-driven default:**
  - Read-Only / Planning: commands are **previewed only**, never executed
    (Planning shows "would run:").
  - Edit: terminal execution only via an explicit scoped grant.
  - Agent: risk-based — low-risk within granted scopes may auto-proceed;
    medium-risk require approval or a session grant; high-risk always confirm.
  - Autonomous: only within the pre-authorized command allowlist and caps.
- **Scoped grants** reduce fatigue: e.g. approve `pytest`, `npm run build`,
  `git status` for the session. Grants never cover dangerous patterns.

---

## 5. Risk Classification

Commands are classified by a layered analysis (allow/deny lists + pattern rules
+ heuristics). Classification is conservative: **ambiguous → treat as higher
risk**.

- **Low:** read-only/informational, idempotent (`ls`, `cat`, `git status`,
  `pwd`, `which`, test list). May auto-proceed within grants in Agent mode.
- **Medium:** builds, tests, formatters, local installs into project env, file
  generation. Require approval or a session grant.
- **High / Dangerous — always explicit confirmation, never auto-approved:**
  - filesystem destruction: `rm -rf`, recursive/forced deletes, `del /s`,
    `format`, `mkfs`, `dd`, truncation of important paths;
  - privilege/system: `sudo`, `su`, service/daemon control, registry edits,
    changing system config, editing `/etc`, scheduled tasks;
  - network egress / remote code: `curl … | sh`, `wget … | bash`, `iwr | iex`,
    downloading and executing scripts, opening reverse shells;
  - global/package mutations: global `npm i -g`, system package managers
    (`apt`, `brew`, `choco`) affecting the machine;
  - anything touching credentials, keychains, `.env`, SSH keys;
  - fork bombs / resource exhaustion patterns;
  - anything attempting to leave workspace roots or manipulate `.git` history.

The classifier is **advisory to the gate, not a substitute for it**: even a
"low" command runs only if the mode/policy permit.

---

## 6. Sandboxing & Isolation (per-platform, best-effort → strong)

Sandboxing is layered; the product does not *rely* on it for safety (the
permission gate is the guarantee) but adds containment where the OS allows:

- **Working-dir & env confinement (all platforms):** cwd forced within roots;
  env is an explicit minimal set (no inheriting the full user env unless the
  user opts in); secrets stripped from child env.
- **Resource limits:** CPU/mem/time limits, output-size caps, max processes.
- **Linux:** optional namespaces/seccomp/cgroups; run under a restricted
  profile; optional container runtime if present (explicit opt-in).
- **macOS:** sandbox profiles where feasible; least-privilege spawn.
- **Windows:** restricted tokens / job objects; constrained environment.
- **Network policy:** default policy can **deny outbound network** for
  agent-initiated commands in stricter modes; egress is a gated capability.
- **Future:** optional "run in container/VM" execution backend as a first-class,
  stronger isolation option for Autonomous/Enterprise.

Isolation capabilities are **surfaced to the user** ("this command ran sandboxed
/ unsandboxed") so trust is informed.

---

## 7. Command Logging

Every execution records (Audit ledger):

- resolved command line + argv, cwd, environment delta (secrets redacted);
- initiator (user vs which agent), mode at time, permission decision + rule,
  approving user + timestamp, any grant used;
- start/end time, duration, exit code, signal;
- captured stdout/stderr (with size caps and redaction of secret-looking tokens);
- classification result and any sandbox profile applied.

Logs are queryable and exportable; secret redaction is applied on capture, not
just display.

---

## 8. Dangerous-Command Handling (defense in depth)

1. **Detect** via classifier (§5).
2. **Block-by-default** in modes below Agent; in Agent/Autonomous, force explicit
   per-command confirmation with a clear, human-readable warning of *why* it is
   dangerous and what it will affect.
3. **No blanket grant** can auto-approve dangerous patterns.
4. **Rewrite suggestions:** where possible, suggest a safer equivalent (e.g.
   move-to-trash instead of `rm -rf`, dry-run flags).
5. **Hard confirmation for irreversible ops**, matching the platform rule that
   destructive operations require explicit, specific approval.

---

## 9. Command History

- Per-workspace history of both user and agent commands, with outcomes, for
  re-run, inspection, and audit.
- Re-running an agent command still passes the gate (history is not a bypass).
- History feeds the classifier's context and the UX (quick approve of previously
  approved safe commands within a session).

---

## 10. Out of Scope (v1)

- Full remote/SSH execution targets (possible future via MCP or a remote backend).
- Arbitrary long-lived background daemons managed by the agent.
- Guaranteeing perfect OS-level sandboxing on every platform (best-effort +
  permission-gate guarantee instead).
