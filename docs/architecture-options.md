# Agent Studio — Architecture Options

> Phase 4
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Goal: choose a high-level system architecture that is secure, testable,
contribution-friendly, maintainable, and supports desktop + CLI + optional web
from a single core.

---

## 1. The Foundational Decision: Engine + Clients

Independent of the monolith-vs-microservices axis, the strongest observed
pattern (OpenCode) is a **local core engine exposing a typed API/SDK, with thin
clients** (desktop GUI, CLI, and later web) built on top.

```
        ┌─────────────┐   ┌──────────┐   ┌───────────┐
        │ Desktop GUI │   │   CLI    │   │  Web (opt) │   Clients (thin)
        └──────┬──────┘   └────┬─────┘   └─────┬─────┘
               │  typed SDK / local IPC / HTTP+SSE  │
               └───────────────┴───────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │   Agent Studio Engine │   (local process)
                    │  permission • audit   │
                    │  agent loop • tools    │
                    └──────────┬────────────┘
        ┌──────────┬───────────┼───────────┬───────────┐
     Providers   File I/O   Terminal      Git         MCP clients
   (LLM APIs)   (sandboxed) (sandboxed)  (libgit)   (stdio / HTTP)
```

This "engine + thin clients" decision is **recommended regardless** of the
internal structure chosen below, because it:
- lets one core serve GUI, CLI, and web without duplicating logic;
- centralizes the security-critical permission + audit boundary in one place;
- keeps clients replaceable and contribution-friendly.

The remaining question is **how the engine itself is structured internally.**

---

## 2. Options for Internal Structure

### Option A — Traditional Monolith
A single codebase/process where modules are informal (no enforced boundaries).

- **Complexity:** Lowest to start.
- **Scalability (of team & code):** Poor; boundaries erode into a "big ball of mud."
- **Testability:** Hard to isolate units; slow, coupled tests.
- **Contribution friendliness:** Low; newcomers can't reason about blast radius.
- **OSS friendliness:** Low; hard to accept isolated contributions safely.
- **Maintainability:** Degrades over time.
- **Verdict:** Too risky for a security-critical, long-lived OSS project.

### Option B — Modular Monolith (single process, enforced module boundaries)
One deployable engine, but with **strict internal module boundaries** (clear
interfaces/traits, dependency rules, internal APIs). Modules: workspace,
provider, session, agent, permission, audit, git, terminal, file, MCP, etc.

- **Complexity:** Moderate; one process, one build, but disciplined interfaces.
- **Scalability:** Good; modules evolve independently behind stable interfaces.
- **Testability:** High; modules mockable at their interfaces; the
  permission/audit boundary is unit-testable in isolation.
- **Contribution friendliness:** High; contributors work within one module.
- **OSS friendliness:** High; clear seams, one repo, one toolchain.
- **Maintainability:** High if boundaries are enforced (lint/arch tests).
- **Verdict:** **Strong fit.**

### Option C — Plugin Architecture (core + plugins)
A minimal core plus capabilities delivered as plugins/extensions (tools,
providers, MCP integrations, UI panels). MCP itself is effectively a plugin
protocol for tools.

- **Complexity:** Moderate–high; plugin API design, versioning, sandboxing.
- **Scalability:** Excellent for ecosystem growth.
- **Testability:** Good for core; plugin surface must be contract-tested.
- **Contribution friendliness:** Excellent; third parties extend without core PRs.
- **OSS friendliness:** Excellent; community can build/ship independently.
- **Security:** Plugins are a real attack surface — must be sandboxed &
  permissioned (see `security-review.md`).
- **Verdict:** **Highly desirable as a layer** — but on top of a solid core, not
  instead of one.

### Option D — Microservices
Engine decomposed into independently deployed services communicating over the
network.

- **Complexity:** High; network, serialization, deployment, versioning overhead.
- **Scalability:** Great for large distributed cloud systems — irrelevant to a
  local-first desktop app.
- **Testability:** Integration testing is heavy; local dev friction high.
- **Contribution friendliness:** Low for a desktop OSS project (hard to run all).
- **OSS friendliness:** Low; contributors must stand up many services.
- **Local-first fit:** Poor; adds moving parts, ports, and failure modes on a
  user's laptop.
- **Verdict:** **Rejected** for the desktop product. (A future *optional*
  enterprise control plane could be a separate service, but not the core.)

### Option E — Hybrid (recommended)
**Modular monolith core (B) + plugin/extension layer (C), delivered as an engine
with thin clients (§1).** Tools/providers/MCP integrations are extensions around
a disciplined core; the core owns the security-critical permission + audit
boundary and is never bypassed by plugins.

---

## 3. Evaluation Matrix

| Criterion | A Monolith | B Modular Monolith | C Plugin | D Microservices | E Hybrid (B+C) |
|---|---|---|---|---|---|
| Complexity (lower=better) | ★★★★★ | ★★★★ | ★★★ | ★ | ★★★ |
| Scalability of code/team | ★ | ★★★★ | ★★★★★ | ★★★★★ | ★★★★★ |
| Testability | ★★ | ★★★★★ | ★★★★ | ★★ | ★★★★★ |
| Contribution friendliness | ★ | ★★★★ | ★★★★★ | ★ | ★★★★★ |
| OSS friendliness | ★★ | ★★★★ | ★★★★★ | ★ | ★★★★★ |
| Long-term maintainability | ★ | ★★★★ | ★★★★ | ★★★ | ★★★★★ |
| Security boundary clarity | ★★ | ★★★★★ | ★★★ | ★★★ | ★★★★★ |
| Local-first fit | ★★★★ | ★★★★★ | ★★★★ | ★ | ★★★★★ |

---

## 4. Recommendation

**Adopt Option E — a Hybrid: a modular-monolith core with a plugin/extension
layer, delivered as a local engine + thin clients (GUI, CLI, optional web).**

Concretely:

1. **One local engine process** owns the agent loop and the **security-critical
   permission + audit boundary**. Every tool call — file, terminal, git, MCP —
   passes through this boundary. Plugins cannot bypass it.
2. **Internal modules with enforced boundaries** (see `core-modules.md`):
   workspace, provider, session, agent, permission, audit, git, terminal, file,
   MCP, settings, identity, extension, knowledge, workflow. Cross-module access
   only via published interfaces; enforce with architecture tests/linting.
3. **Extension layer** for the parts that benefit from ecosystem growth:
   - **Tools** exposed to agents (MCP-native, process-isolated).
   - **Providers** behind a common interface.
   - **UI panels / commands** in clients.
   Extensions declare required permissions and run with least privilege.
4. **Thin clients over a typed SDK** and an event stream (SSE-style) for live
   updates, mirroring OpenCode's proven decoupling.
5. **Start simpler, keep seams:** v0.x may ship built-in tools in-process behind
   the same interfaces the plugin API will use, so extracting them into the
   plugin system later is mechanical, not a rewrite.

### Why not the others
- **A** rots and is unsafe for security-critical OSS.
- **D** imposes distributed-systems cost on a laptop for no benefit.
- **B alone** is great but leaves ecosystem growth on the table.
- **C alone** risks a thin/insecure core; the permission+audit boundary must be
  first-party and non-bypassable.

---

## 5. Language / Runtime Considerations (informing, not deciding, here)

The internal architecture interacts with the desktop-framework choice
(`desktop-strategy.md`) and provider layer (`provider-architecture.md`). Two
coherent stacks emerge:

- **Rust core (à la Goose) + Tauri v2 shell + web-tech UI.** Best for
  performance, memory safety, small bundles, and a strong security posture;
  higher contribution bar (Rust).
- **TypeScript/Node (or Bun) core (à la OpenCode) + Tauri/Electron shell.** Best
  for contributor breadth and reuse of the rich JS AI/MCP ecosystem; larger
  footprint / weaker memory-safety guarantees.

The final recommendation is made in `desktop-strategy.md` and
`final-planning-report.md`. The architecture in this document is deliberately
**language-agnostic**: the modular-monolith-core + plugin + engine/clients shape
holds either way.

---

## 6. Key Architectural Invariants (must survive all future changes)

1. **Single permission + audit boundary.** No code path performs a consequential
   action without passing the permission check and emitting an audit record.
2. **Tools are least-privilege and isolated.** Especially third-party/MCP tools.
3. **Clients are replaceable and untrusted for policy.** Policy lives in the
   engine, not the UI; a malicious/broken client cannot escalate privilege.
4. **Local-first.** The engine runs fully offline; no mandatory backend.
5. **Deterministic, replayable audit.** The action ledger is the source of truth
   for "what happened."
