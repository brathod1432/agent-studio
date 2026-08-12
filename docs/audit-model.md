# Agent Studio — Audit Model

> Phase 17
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

**Every action must be traceable.** Auditability is an architectural invariant
(`architecture-options.md`, `permission-model.md`): no consequential action
occurs without an audit record. The audit ledger is the source of truth for
"what happened, when, who authorized it, and what resulted."

---

## 1. Goals

1. **Completeness:** every user action, agent action, permission decision, and
   tool operation is recorded.
2. **Attribution:** each record states the actor (user / which agent), the
   authorizer, the session, and the workspace.
3. **Integrity:** the ledger is append-only and tamper-evident.
4. **Explainability:** records answer *why* (which mode, which rule, which risk
   class) not just *what*.
5. **Usability:** human-readable reports and machine-readable exports.
6. **Privacy:** secrets are redacted; the ledger is local by default.

---

## 2. What Is Recorded

| Category | Examples |
|---|---|
| **User actions** | open/close workspace, switch mode, grant/revoke permission, approve/reject, edit plan, run own command |
| **Agent actions** | prompt/response turns, tool-call requests, plans proposed, role/mode used, model + tokens + cost |
| **Permission events** | check → allow/deny/require-approval, the rule/risk class applied, the grant used, approver + timestamp |
| **File operations** | read/create/modify/rename/move/delete, target path(s), before/after hashes, size, diff ref, snapshot id |
| **Terminal commands** | resolved command, cwd, env delta (redacted), classification, exit code, duration, output ref, sandbox profile |
| **Git operations** | op type, refs/commit ids, message, attribution trailer |
| **MCP operations** | server, transport, tool, args (redacted), result ref, endpoint |
| **Provider calls** | provider/model, tokens in/out, cost estimate, fallback events |
| **Session activity** | start/stop, resume, export, errors, Stop invocations |
| **System/config** | provider added/edited, MCP server enabled, settings/policy changes |

---

## 3. Record Structure (conceptual)

Append-only events; illustrative shape:

```jsonc
{
  "id": "monotonic-id",
  "ts": "2026-08-12T10:15:03.221Z",
  "workspaceId": "uuid",
  "sessionId": "uuid",
  "actor": { "type": "agent|user", "id": "developer-agent|user" },
  "authorizedBy": { "type": "user", "id": "user", "grantId": "…|null" },
  "mode": "agent",
  "category": "file.modify",
  "action": { /* category-specific details, paths, refs */ },
  "decision": { "result": "allow|deny|approved|rejected",
                "rule": "policy.writableGlobs", "riskClass": "medium" },
  "result": { "status": "success|error", "detail": "…", "artifactRefs": ["diff:…","snapshot:…"] },
  "redactions": ["env.GITHUB_TOKEN"],
  "prevHash": "…", "hash": "…"          // tamper-evident chain
}
```

Large payloads (full diffs, command output) are stored as referenced artifacts
(with hashes) rather than inline, keeping the ledger compact and queryable.

---

## 4. Integrity (tamper-evidence)

- **Append-only** store; no in-place edits or deletes through normal APIs.
- **Hash chaining:** each record includes the previous record's hash, forming a
  verifiable chain; tampering breaks the chain and is detectable.
- **Verification tool:** a command to verify ledger integrity for a
  session/workspace.
- **Enterprise (future):** optional signing and export to an external
  append-only/WORM store or SIEM; centralized, immutable retention.

Note: on a fully local single-user machine, a determined local admin can access
storage; the goal is *tamper-evidence and completeness*, plus stronger
guarantees (signing, external sink) in Enterprise mode.

---

## 5. Storage

- Local, per-workspace, in app-managed private storage (SQLite recommended for
  queryability), separate from the shareable `.agentstudio/` folder.
- Retention policy with size caps and safe archival; artifacts (diffs, output)
  garbage-collected per retention while preserving the event chain.
- **Redaction at write time:** secret-looking tokens and known secret env vars
  are redacted before storage, not merely hidden in the UI.

---

## 6. Reports & Exports

- **Session report:** human-readable timeline — what the agent did, what was
  approved/denied, files changed (with diffs), commands run (with outcomes),
  cost, and final state. One-click export.
- **Workspace report:** rollups across sessions (activity, changes, spend, denied
  attempts).
- **Filtered queries:** by category, actor, path, risk class, decision, time.
- **Export formats:** JSON (machine), Markdown/HTML/PDF (human), CSV (tabular);
  optional SIEM/JSONL for enterprise ingestion.
- **Change manifest:** exportable "here is exactly what changed this session"
  suitable for code review or compliance.

---

## 7. UX: The Action Feed

- A **live, filterable timeline** is a primary UI surface (not buried): as the
  agent works, each proposed/performed action streams in with its decision,
  risk, and result.
- Click any entry to see full detail (diff, command output, rule that applied).
- Denied/blocked attempts are shown too (important for trust and debugging).
- The feed doubles as the review surface for Autonomous-run post-mortems.

---

## 8. Relationship to Reversibility

The audit ledger references the artifacts that make undo possible (snapshot ids,
git commit ids, trash entries — see `file-system-architecture.md`,
`git-architecture.md`). "Undo" and "rollback" actions are themselves audited, so
the record remains a complete, honest history including corrections.

---

## 9. Privacy & Safety

- **Local by default;** no audit data leaves the machine unless the user/org
  exports it.
- **No secrets in the ledger** (redaction invariant).
- **Opt-in only** for any external sink/telemetry; transparent about what leaves.
- Audit cannot be silently disabled; disabling/relaxing it (where even permitted)
  is itself a conspicuous, recorded event, and is **not** permitted for
  consequential actions (per `product-boundaries.md`).

---

## 10. Out of Scope (v1)

- Centralized multi-user/fleet audit aggregation (Enterprise, post-v1).
- Cryptographic third-party notarization of the ledger (future).
- Real-time streaming to external SIEMs (Enterprise, post-v1).
