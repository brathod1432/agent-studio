# Agent Studio — Final Planning Report

> Phase 20 — Synthesis of all planning phases
> Status: Planning only. **No implementation authorized.**
> Last updated: 2026-08-12

This report consolidates the planning set into a single decision document. It is
the recommended blueprint for Agent Studio before any code is written. Fast-
moving external facts (framework versions, provider catalogs, MCP spec revisions)
should be re-validated at implementation time.

**Companion documents:** `vision.md`, `competitive-analysis.md`,
`product-boundaries.md`, `architecture-options.md`, `core-modules.md`,
`workspace-model.md`, `permission-model.md`, `file-system-architecture.md`,
`terminal-architecture.md`, `git-architecture.md`, `provider-architecture.md`,
`nvidia-strategy.md`, `mcp-strategy.md`, `multi-agent-strategy.md`,
`ui-research.md`, `desktop-strategy.md`, `audit-model.md`, `security-review.md`,
`roadmap.md`.

---

## 1. Executive Summary

Agent Studio is a **local-first, provider-agnostic, workspace-centric AI agent
desktop application** for technical professionals — not a chatbot, not a coding-
only assistant. Its category-defining bet is **control**: a graduated permission
model, complete auditability, and reversibility enforced as **architectural
invariants**, combined with radical provider neutrality (NVIDIA first-class) and
reach beyond coders.

The market is crowded with coder-first, editor/terminal-bound, often closed or
cloud-tied tools. None combines workspace-first design, graduated permissions,
first-class audit, reversibility, provider neutrality, *and* non-coder reach.
That is the gap Agent Studio should own.

The recommended path is deliberately **trust-before-breadth**: prove the
controlled action loop end-to-end, then expand connectivity (git, MCP), then
polish and secure for a GA single-user product, and only then add autonomy,
multi-agent orchestration, and enterprise governance.

---

## 2. Recommended Technology Stack

| Layer | Recommendation | Rationale | Alt / fallback |
|---|---|---|---|
| **Desktop shell** | **Tauri v2** | Security-by-default (capability model, audited), tiny bundles, low RAM, signed updater, full packaging matrix + future mobile | Electron (if JS-only team / rendering parity is critical) |
| **Engine language** | **Rust** | Memory-safety for a security-critical core; pairs with Tauri; Goose-proven | TypeScript/Bun (OpenCode-proven; broader contributor pool) |
| **Architecture** | Local **engine + typed SDK + thin clients**; modular-monolith core + plugin layer | One core for GUI/CLI/web; single non-bypassable security boundary; contribution-friendly | — |
| **UI framework** | React + **shadcn/ui on Radix** (own the code) | MIT, excellent a11y, auditable, small footprint | Solid + **Ark UI** (if mirroring OpenCode) |
| **Provider layer** | Unified adapter (AI-SDK-style); OpenAI-compatible adapter covers NVIDIA/OpenRouter/Ollama/LM Studio/custom; native adapters for Anthropic/Gemini/Azure | Neutrality with minimal code; NVIDIA first-class via compat | — |
| **Tool interop** | **MCP** (stdio + Streamable HTTP), process-isolated | Standard, ecosystem leverage, isolation | — |
| **Local storage** | **SQLite** (sessions, audit, index) + OS keychain for secrets | Queryable, embeddable, offline; keychain for secret safety | — |
| **Git** | Library binding (e.g. `git2`) + system `git` fallback for hooks | Structured results, fewer parsing/security pitfalls | — |
| **Packaging** | Signed EXE+MSI, AppImage+deb/rpm, macOS app+dmg, CLI binary; signed auto-update; SBOM | Meets deliverable matrix + supply-chain transparency | — |

**Honest tension:** *Rust core* maximizes safety/performance but narrows the
contributor pool; *TS/Bun core* maximizes contributor breadth and ecosystem reuse
but weakens the memory-safety story. Because the **UI is web-tech either way** and
the **security boundary lives in the engine**, this decision is contained and can
be finalized with a prototyping spike (see §9). Default recommendation: **Rust +
Tauri**, keeping the engine/clients boundary clean so a reversal is feasible.

---

## 3. Recommended Architecture

**Hybrid: modular-monolith engine + plugin/extension layer, exposed via a typed
SDK to thin clients (Desktop GUI, CLI, optional Web).**

- **One local engine** owns the **single permission + audit boundary**. Every
  consequential action — file, terminal, git, MCP, provider — passes through it.
  No client and no plugin can bypass it.
- **Enforced internal modules** (`core-modules.md`): Workspace, Provider,
  Session, Agent, Permission, Audit, Git, Terminal, File, MCP, Settings,
  Identity, Extension, Knowledge, Workflow.
- **Extension layer** for tools/providers/UI, MCP-native and process-isolated,
  least-privilege, declared-permission.
- **Clients are replaceable and untrusted for policy;** live UI via an
  SSE-style event stream (validated by OpenCode).

**Invariants (never traded away):** single non-bypassable permission+audit
boundary; least-privilege isolated tools; local-first/offline; deterministic
replayable audit; deny-by-default/fail-safe.

---

## 4. Recommended Desktop Framework

**Tauri v2**, over the engine+clients architecture, with a web-tech UI.

- Chosen because its **security-by-default capability model** directly reinforces
  the product's central trust promise, plus small bundles, low memory, a signed
  updater, and coverage of all six deliverable targets.
- **Mitigations:** per-platform WebView QA; keep the engine in Rust but the UI in
  web tech so web contributors can help; use Rust crates instead of shelling out
  to preserve the bundle-size advantage.
- **Reversibility of the decision:** because policy/audit live in the engine, the
  shell can be swapped to **Electron** later without touching the security core —
  a strong de-risking property. Electron remains the fallback if the team is
  JS-only or rendering parity proves business-critical (with full hardening).

---

## 5. Security Assessment

**Posture: strong by design, contingent on disciplined execution.**

- **Strengths:** single non-bypassable permission+audit boundary; deny-by-default;
  secrets in OS keychain and never brokered; untrusted-output-as-data principle
  against prompt injection; reversibility as a safety net; Tauri's capability
  model; process isolation for MCP/extensions.
- **Top threats (`security-review.md`):** prompt injection, dangerous commands,
  credential leakage, MCP/supply-chain risk. All are mitigated primarily by the
  permission gate + destructive-action confirmation + reversibility, backed by
  defense-in-depth (sandboxing, classification, redaction, SBOM, signing).
- **Residual risks (honest):** compromised OS/local admin; WebView/runtime 0-days;
  sophisticated injection that still produces bad *proposals*; user over-granting.
  Mitigated by tamper-evident audit, timely updates, clear UX, and (Enterprise)
  signing + external sinks.
- **Gate for GA:** an **external security audit before v1.0** (as Tauri v2 did),
  plus CI security gates (dependency scan, SBOM, license check, secret scanning)
  and a coordinated vulnerability-disclosure policy.

**Assessment: acceptable to proceed**, provided the invariants are treated as
non-negotiable and the pre-implementation security to-dos (`security-review.md`
§7) are completed at design time.

---

## 6. Risk Assessment

| Risk | Severity | Likelihood | Mitigation | Residual |
|---|---|---|---|---|
| Scope explosion (15 modules / 6 personas / 6 targets) | High | High | Trust-before-breadth roadmap; ruthless v1 scope; vertical slices | Medium |
| Trust failure (one unapproved destructive action) | Critical | Low (by design) | Permission+audit+reversibility invariants; destructive-confirm | Low |
| Prompt injection | High | High | Gate as backstop; output-as-data; egress control; guardrails | Medium |
| Provider/API churn | Medium | High | Adapter abstraction; capability negotiation; localized NVIDIA glue | Low |
| Desktop packaging burden (6 targets) | Medium | Medium | Tauri packaging + signed updater; phase platforms in v0.5→v1.0 | Low |
| Rust contributor scarcity | Medium | Medium | Web-tech UI opens contribution; spike to validate; TS fallback | Medium |
| Crowded market | High | High | Differentiate on control/audit/neutrality/non-coder, not features | Medium |
| Non-coder UX difficulty | Medium | Medium | Progressive disclosure; persona templates; keyboard-first a11y | Medium |
| OSS sustainability/governance | Medium | Medium | Modular design; clear license/governance; dogfooding; community from v0.5 | Medium |
| Supply-chain compromise | High | Low–Med | Vetted deps, ≥7-day-old versions, lockfiles, SBOM, signing | Low |

---

## 7. MVP Scope (through v1.0)

**In (the trustworthy single-user workspace agent):**
- Engine + CLI + Tauri GUI over one typed SDK.
- Workspace-first: open folder/workspace, config/policy, session persistence,
  basic knowledge (tree/symbol maps → local retrieval by v1.0).
- Providers: NVIDIA (hosted + self-hosted NIM), OpenAI, Anthropic, Ollama,
  OpenAI-compatible; key entry, validation, model discovery, cost accounting.
- Permission modes **Read-Only, Planning, Edit, Agent** with capability matrix,
  grants, and explainable decisions.
- File ops (read/create/modify/rename/move/delete/bulk) with diff preview,
  approval, snapshots, trash, undo/rollback.
- Terminal with approval, risk classification, logging, per-platform sandboxing.
- Git read + gated writes (commit/stage/branch) + git-based undo; push
  deny-by-default.
- MCP: stdio + Streamable HTTP, per-tool allowlists, gated + audited calls.
- Complete audit ledger with reports/exports and integrity verification.
- Secure secret storage; accessibility (WCAG AA target); signed multi-platform
  packaging; external security audit.

**Out of MVP (deferred to v2.0):** Autonomous mode, multi-agent orchestration,
Enterprise governance/SSO, Workflow Manager, optional Web interface, extension/
MCP marketplace, deep forge integrations, additional providers beyond the
first-class set.

---

## 8. Future Scope (v2.0+)

Bounded Autonomous mode; supervised multi-agent orchestration; Workflow Manager;
Enterprise mode (policy control plane, SSO, centralized signed audit/SIEM,
provider governance); optional self-hosted Web interface; extension/MCP
marketplace with signing; container/VM execution backend + guardrails; deeper
git-forge integrations; expanded provider set (Gemini, Azure, OpenRouter, …).

---

## 9. Key Tradeoffs (decisions to confirm via spikes, not debate)

1. **Rust vs TS/Bun engine** — safety/performance vs contributor breadth/ecosystem.
   *Action:* a 1–2 week spike building the minimal permission-gated file-edit loop
   in both to compare velocity, packaging, and the MCP/provider ecosystem fit.
2. **Tauri vs Electron shell** — security/size vs rendering parity/ecosystem.
   *Recommendation:* Tauri; decision is reversible due to the engine boundary.
3. **React vs Solid UI** — ecosystem/hiring (React+shadcn) vs OpenCode-alignment
   (Solid+Ark). Tied to §1.
4. **Breadth vs trust** — resist feature-matching competitors; win on control.
   *Recommendation:* trust-first, already reflected in the roadmap.
5. **Sandboxing depth vs simplicity** — permission gate is the guarantee;
   OS sandboxing is phased defense-in-depth, with container/VM execution in v2.0.

---

## 10. Overall Recommendation

**Proceed to a design/prototyping phase — not full implementation — with the
following commitments:**

1. **Adopt the hybrid engine+clients architecture** with a single, non-bypassable
   permission+audit boundary as the product's spine.
2. **Default to Rust engine + Tauri v2 shell + React/shadcn UI**, but **run the
   Rust-vs-TS and (if needed) React-vs-Solid spikes** before locking the stack.
3. **Build trust-first per the roadmap** (v0.1 controlled action loop → v1.0 GA),
   never weakening the invariants for speed.
4. **Make NVIDIA and provider neutrality first-class from v0.1** via the
   OpenAI-compatible adapter.
5. **Treat security as a gating discipline:** complete the pre-implementation
   security to-dos and schedule an external audit before v1.0.
6. **Target the underserved audience:** professionals (coders *and* non-coders)
   who need controlled, auditable AI on real work — the defensible position no
   incumbent currently holds.

**Bottom line:** the vision is ambitious but coherent, the market gap is real and
defensible, and the principal risks (scope, trust, security, stack) are
manageable with disciplined phasing and two focused prototyping spikes. The plan
is sound; the recommendation is to advance to the design/prototype stage under
the invariants above.

---

## 11. Open Questions to Resolve Before Implementation

1. Final engine language and UI framework (resolve via §9 spikes).
2. Exact default deny-globs and dangerous-command pattern catalog.
3. Per-platform keychain and sandboxing library choices.
4. Local embedding/indexing approach for privacy-first knowledge (incl. local
   NIM embeddings).
5. Open-source **license** (permissive — MIT/Apache-2.0 — to keep the core
   commercially usable and contribution-friendly) and **governance model**.
6. Minimum supported OS versions and WebView baselines.
7. Telemetry stance (recommended: none by default; strictly opt-in, transparent).
8. Naming/branding and trademark clearance for "Agent Studio".
