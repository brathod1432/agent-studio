# Agent Studio — Multi-Agent Strategy

> Phase 14
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Question addressed: should Agent Studio support multiple specialized agents, and
if so, when and how? Conclusion up front: **v1 ships a single, capable agent with
selectable roles/modes; true multi-agent orchestration is a deliberate post-v1
capability** built on the same permission/audit invariants.

---

## 1. Candidate Agent Roles

| Agent | Purpose | Typical tools | Value | Complexity |
|---|---|---|---|---|
| **Planner** | Decompose goals, produce plans, coordinate | read, retrieval | High | Low–Med |
| **Developer** | Implement code changes | file, terminal, git | High | Med |
| **QA / Test** | Write/run tests, validate | file, terminal | High | Med |
| **Security** | Audit, threat-model, dependency review | read, retrieval, terminal (scan) | High | Med |
| **Documentation** | Draft/edit docs from source | file, retrieval | High | Low–Med |
| **Research** | Gather/synthesize external info | web, MCP, retrieval | Med–High | Med |
| **Operations** | Ops tasks, runbooks | terminal, MCP | Med | High (risk) |
| **DevOps** | CI/CD, infra changes | file, terminal, git, MCP | Med | High (risk) |

---

## 2. Usefulness vs Complexity

**Where multi-agent genuinely helps:**
- **Separation of concerns:** a Planner that only reads/plans, then hands
  scoped work to a Developer, maps cleanly onto the permission model (Planner =
  Read-Only/Planning; Developer = Agent) and improves safety and reviewability.
- **Specialized context/prompts:** role-tuned system prompts and tool allowlists
  produce better, safer behavior than one over-loaded generalist.
- **Parallelizable, independent subtasks:** e.g. docs + tests generated in
  parallel for a finished feature.
- **Review separation:** a Security or QA agent reviewing the Developer agent's
  output is a strong, auditable pattern.

**Where it adds cost/risk:**
- **Orchestration complexity:** inter-agent messaging, shared state, deadlocks,
  runaway loops, and cost multiplication.
- **Auditability strain:** "who did what" gets harder — but our audit model must
  attribute every action to a specific agent regardless, so this is a
  requirement, not an excuse to skip it.
- **Permission surface:** each agent needs correctly scoped permissions;
  mis-scoping is a security risk.
- **UX confusion:** non-coder users can be overwhelmed by multiple agents acting
  at once.

---

## 3. MVP Suitability

**Not suitable as core v1.** The v1 thesis is *trust*: control, audit,
reversibility, provider neutrality. Multi-agent orchestration multiplies the
surface for all four and would dilute the core proof. It is also easy to get
wrong (cost blowups, tangled audit).

**v1 approach — one agent, many roles (validated by Roo Code modes, OpenCode/
Claude plan-vs-build):**
- A single agent with **selectable roles** (Planner, Developer, QA, Security,
  Docs, Research) that set the system prompt, tool allowlist, and *default
  permission mode* for that role.
- Switching role is an explicit, audited action; e.g. "Planner (Planning mode)"
  → produce plan → user switches to "Developer (Agent mode)" to execute.
- **Subtasks, not sub-agents:** the single agent may internally spawn scoped
  sub-tasks (like the platform's subagent pattern) for parallel/independent work
  *without* exposing a full multi-agent orchestration surface — each sub-task's
  actions still pass the one gate and are attributed in the audit.

This delivers ~80% of the practical benefit (role specialization, plan/execute
separation) at a fraction of the risk.

---

## 4. Post-v1 Multi-Agent Design (when we build it)

Principles to preserve the product's invariants:

1. **One permission gate, per-agent scope:** every agent's every action still
   passes the single Permission + Audit boundary; each agent has its own scoped
   policy (e.g. Security agent is read-only + scan tools; Developer can write in
   `src/`).
2. **Explicit orchestration, bounded:** a Planner/orchestrator delegates
   **scoped tasks** with budgets (steps, files, spend, time). Runaway protection
   and global Stop are mandatory.
3. **Full attribution:** the audit ledger records *which agent* performed each
   action and *which agent/user* authorized it.
4. **Human-in-the-loop by default:** hand-offs and any consequential action still
   surface for approval per mode; Autonomous multi-agent is bounded and
   checkpointed like single-agent Autonomous.
5. **Cost governance:** multi-agent runs require spend/step caps up front.
6. **Deterministic, replayable transcripts:** the whole multi-agent run is
   reconstructable from the audit ledger.

Interaction patterns to support later: **supervisor/worker** (Planner →
specialists), **reviewer** (QA/Security reviews Developer output), and
**parallel independent** (docs + tests). Avoid free-for-all agent chat.

---

## 5. Recommendation

- **v1:** single agent, selectable roles + modes, optional internal scoped
  sub-tasks. No user-facing multi-agent orchestration.
- **Post-v1 (Phase D per `roadmap.md`):** introduce supervised, bounded
  multi-agent orchestration (Planner + Developer + QA/Security + Docs) once the
  permission/audit/reversibility foundation is proven and hardened.
- **Never:** unbounded autonomous agent swarms acting without caps, attribution,
  or a global stop.

---

## 6. Open Questions (to resolve before Phase D)

- How to present multiple concurrently-acting agents to non-coder users without
  overwhelming them?
- Default budget/cap policies for orchestrated runs.
- Whether specialized agents should use different models/providers by role
  (ties into provider role-routing, `provider-architecture.md`).
- Conflict handling when two agents propose incompatible changes to the same
  files.
