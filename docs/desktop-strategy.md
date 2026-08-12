# Agent Studio — Desktop Application Strategy

> Phase 16
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Agent Studio is desktop-first. Deliverables (future): Windows EXE + MSI, Linux
AppImage + package, macOS app, CLI, and an optional web interface. This document
chooses the shell/framework. Benchmark figures below are from 2025–2026 industry
comparisons and should be re-validated at build time.

---

## 1. Options

### 1.1 Electron
- **Model:** bundles Chromium + Node.js with each app.
- **Pros:** most mature desktop ecosystem (VS Code, Slack, Discord, Figma, 1Pass);
  identical rendering everywhere; proven signing/auto-update/packaging; all-JS;
  full Node ecosystem (e.g. `simple-git`, `better-sqlite3`) directly usable.
- **Cons:** large installers (~50–150 MB+), high idle RAM (~100–300 MB),
  security is opt-in hardening (nodeIntegration/context-isolation footguns).

### 1.2 Tauri (v2)
- **Model:** OS-native WebView (WebView2 / WKWebView / WebKitGTK) + Rust core;
  sub-MB core.
- **Pros:** tiny installers (~3–15 MB typical), low idle RAM (~20–100 MB),
  **capability-based security** (WebView gets zero native access by default;
  reach the system only via explicitly granted capabilities), built-in signed
  updater, mobile targets since v2, and v2 passed an independent security audit.
- **Cons:** rendering varies with OS WebView (per-platform QA); Node libraries
  aren't directly usable (write Rust or shell out); steeper bar if the team
  lacks Rust; ecosystem younger than Electron's.

### 1.3 Native (per-platform toolkits)
- **Model:** WinUI/WPF, SwiftUI/AppKit, GTK/Qt per OS.
- **Pros:** best possible performance/native feel.
- **Cons:** 3× the UI work, hostile to a small OSS team and to code sharing with
  a future web client; contribution-unfriendly. **Rejected for the core UI.**

### 1.4 Hybrid (engine + thin shell, our chosen shape)
- **Model:** a standalone **local engine** (owning permissions/audit/agent/tools)
  + a thin desktop **shell** rendering a web-tech UI + a **CLI** that talks to the
  same engine (per `architecture-options.md`, validated by OpenCode).
- **Pros:** one core serves GUI + CLI + optional web; the shell is replaceable;
  the security boundary lives in the engine, not the UI. Compatible with either
  Tauri or Electron as the shell.

---

## 2. Evaluation

| Criterion (weight) | Electron | Tauri v2 | Native |
|---|---|---|---|
| Performance / RAM (High) | ★★ | ★★★★★ | ★★★★★ |
| Security posture (High) | ★★★ | ★★★★★ | ★★★★ |
| Bundle size (High) | ★★ | ★★★★★ | ★★★★ |
| Packaging matrix incl. mobile (Med) | ★★★★ | ★★★★★ | ★★ |
| Ecosystem maturity (Med) | ★★★★★ | ★★★ | ★★★ |
| Contributor breadth (Med) | ★★★★★ (JS) | ★★★ (Rust) | ★ |
| Rendering consistency (Med) | ★★★★★ | ★★★ | ★★★★★ |
| Auto-update tooling (Med) | ★★★★ | ★★★★ | ★★ |
| Long-term extensibility (Med) | ★★★ | ★★★★ | ★★★ |
| Local-first / offline fit (High) | ★★★★ | ★★★★★ | ★★★★★ |

---

## 3. Recommendation

**Primary: Tauri v2 as the desktop shell, over the engine + thin clients
architecture, with a web-tech UI (see `ui-research.md`).**

Rationale — Tauri's strengths line up with our core principles:
- **Security by default** (capability-based; audited v2) reinforces the product's
  central control/trust promise better than Electron's opt-in hardening.
- **Small bundles + low RAM** matter for a tool professionals keep open all day
  and download across six targets.
- **Cross-platform packaging** (EXE/MSI/AppImage/deb-rpm/macOS) and a **signed
  built-in updater** cover the deliverable matrix; mobile is a future option.
- A **Rust engine + Tauri** is the same coherent stack Goose uses and gives us
  memory-safety for the security-critical core.

**Honest tradeoffs / mitigations:**
- **WebView inconsistency:** invest in per-platform UI QA; keep the UI within
  well-supported web features; a shared component library (`ui-research.md`)
  reduces surface.
- **Rust contribution bar:** keep the *engine* in Rust but the *UI* in web tech
  (React/Solid), so the large pool of web contributors can help with the UI; the
  engine + typed SDK boundary decouples the two.
- **No direct Node libs:** use Rust crates (`git2`, `rusqlite`, process/PTY
  crates) rather than shelling out, preserving the bundle-size win.

**Fallback: Electron** — choose it only if the team is JS-only and cannot absorb
Rust, or if identical cross-platform rendering proves business-critical. If so,
apply the full security-hardening checklist (context isolation on, nodeIntegration
off, strict CSP, `electron-updater` with signing) — the permission/audit
invariants must hold regardless of shell.

**Architecture-preserving note:** because policy/audit live in the **engine**,
not the shell, the shell choice is *reversible*. We could ship Tauri and, if a
hard blocker appears, swap to Electron without touching the security core. This
de-risks the decision.

---

## 4. CLI & Optional Web

- **CLI:** a first-class client over the same engine (the engine can run headless
  and expose its typed API locally). Ship the CLI everywhere; it is the scripting
  and CI surface and validates the engine/clients split from day one.
- **Optional Web:** the same web-tech UI, served by the engine's local server
  (HTTP + SSE) for users who prefer a browser or remote-into-their-own-machine
  scenarios. Strictly local/self-hosted by default; **not** a hosted SaaS. Bind
  to localhost, require auth, and validate `Origin` (see `security-review.md`).

---

## 5. Packaging & Distribution (deliverable matrix)

| Target | Mechanism (Tauri) | Notes |
|---|---|---|
| Windows EXE | NSIS bundle | code-signed |
| Windows MSI | WiX bundle | for managed/enterprise deploys |
| Linux AppImage | Tauri AppImage | portable |
| Linux package | `.deb` / `.rpm` | distro repos |
| macOS app | `.app` / `.dmg` | signed + notarized |
| CLI | standalone binary | all platforms |
| Web (optional) | static assets + engine server | self-hosted only |

Cross-cutting: **code signing + notarization** on all platforms; **signed
auto-updates** (Tauri updater with key-pair verification); reproducible builds
where feasible; SBOM generation for supply-chain transparency
(`security-review.md`).

---

## 6. Decision Dependencies

- **Engine language:** Rust (recommended, pairs with Tauri and Goose-style
  safety) vs TypeScript/Bun (pairs with Electron/OpenCode-style contributor
  breadth). Final call in `final-planning-report.md`. The **engine + thin
  clients + non-bypassable permission/audit boundary** is invariant to this
  choice.
- **UI framework:** React (+ shadcn/Radix) or Solid (+ Ark UI), per
  `ui-research.md`.
