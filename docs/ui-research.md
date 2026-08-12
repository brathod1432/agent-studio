# Agent Studio — UI Research

> Phase 15
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Evaluates open-source UI systems for Agent Studio's client(s). Assumes a
web-tech UI (React/Solid) rendered in a desktop shell (`desktop-strategy.md`),
which lets the same components serve the optional future web interface.
Licensing/versions should be re-verified before adoption.

---

## 1. Requirements

- **License:** permissive (MIT/Apache/ISC); **no copyleft or non-commercial**
  dependencies in a core that must stay open and commercially usable
  (`product-boundaries.md`).
- **Accessibility:** WCAG-minded, keyboard-first, screen-reader support (many
  target users rely on keyboard workflows).
- **Ownership/control:** prefer systems where we *own the component code* (fewer
  runtime black boxes, easier auditing/security, no forced upgrades).
- **Composability:** rich primitives for diffs, trees, tables, command palette,
  modals/approvals, resizable panels, code/markdown rendering.
- **Theming:** light/dark, high-contrast, density options for pro users.
- **Maintenance & community:** active, healthy, unlikely to be abandoned.
- **Security:** minimal transitive deps; no telemetry; auditable.

---

## 2. Candidates

### 2.1 Radix UI (Primitives)
- **What:** unstyled, accessible React primitives (dialog, popover, dropdown,
  tabs, tooltip, etc.).
- **License:** MIT.
- **Accessibility:** excellent — a11y is the core value proposition.
- **Security/maintenance:** widely used, well-maintained, minimal deps.
- **Fit:** the **accessibility foundation**; you style on top.
- **Caveat:** primitives only — no batteries-included components.

### 2.2 shadcn/ui
- **What:** copy-in components built on Radix + Tailwind. You **own the code**
  (components are added to your repo, not a runtime dependency).
- **License:** MIT.
- **Accessibility:** inherits Radix's strong a11y.
- **Security/maintenance:** you own/audit the code; low black-box risk; very
  active ecosystem.
- **Fit:** **strong primary choice** — ownership + a11y + control + auditability
  align tightly with our security posture.
- **Caveat:** Tailwind + owning code = you maintain your components (a feature
  here, not a bug).

### 2.3 Magic UI
- **What:** animated/marketing-oriented components, shadcn/Tailwind-compatible.
- **License:** MIT.
- **Accessibility:** varies by component (motion-heavy).
- **Fit:** **selective** — useful for polish/landing/onboarding, not core
  workbench surfaces; respect reduced-motion preferences.
- **Caveat:** animation can hurt a11y/perf if overused in a pro tool.

### 2.4 Origin UI
- **What:** large library of shadcn/Tailwind-compatible component examples.
- **License:** MIT.
- **Accessibility:** inherits Radix/shadcn base.
- **Fit:** **accelerator** — pattern/reference source to speed building on the
  shadcn base; copy-in, so we still own the code.
- **Caveat:** examples vary in quality; vet before adopting.

### 2.5 Other systems (briefly)
- **Headless UI** (MIT) — accessible primitives, smaller scope than Radix;
  viable alternative/supplement.
- **React Aria / React Spectrum** (Adobe, Apache-2.0) — best-in-class a11y
  primitives; heavier, excellent for accessibility-critical surfaces; strong
  option if we prioritize a11y depth.
- **Ark UI** (MIT) — framework-agnostic (React/Solid/Vue) primitives; **notable
  if we choose Solid** (à la OpenCode) rather than React.
- **Mantine / MUI / Chakra** — full runtime component libraries; more black-box,
  heavier deps, less code-ownership; MUI's ecosystem has some non-MIT tiers —
  **avoid runtime-heavy, less-auditable libs for the core.**

---

## 3. Comparison

| System | License | A11y | Code ownership | Deps footprint | Best role |
|---|---|---|---|---|---|
| Radix | MIT | ★★★★★ | primitives you style | small | a11y foundation |
| shadcn/ui | MIT | ★★★★★ (via Radix) | **you own it** | small | **core components** |
| Magic UI | MIT | ★★★ | you own it | small | polish/onboarding |
| Origin UI | MIT | ★★★★ | you own it | small | patterns/accelerator |
| React Aria | Apache-2.0 | ★★★★★ | primitives | medium | a11y-critical surfaces |
| Ark UI | MIT | ★★★★★ | primitives | small | if Solid/multi-fw |
| MUI/Mantine/Chakra | mixed | ★★★★ | runtime dep | large | avoid for core |

---

## 4. Recommendation

**If React:** **shadcn/ui (on Radix) as the core system**, using **Origin UI** as
a pattern accelerator and **Magic UI** sparingly for onboarding/marketing polish.
Rationale: permissive MIT throughout, excellent accessibility via Radix, **we own
the component code** (critical for security auditing and long-term control), and
a small, auditable dependency footprint — a direct match to our openness/security
principles. Consider **React Aria** for the most accessibility-sensitive
surfaces.

**If Solid** (to mirror OpenCode's stack): **Ark UI + Tailwind** as the
primitive/styling base, mirroring the shadcn philosophy (own the code, Radix-like
a11y) in the Solid ecosystem.

The framework choice (React vs Solid) is settled alongside the desktop shell in
`desktop-strategy.md` / `final-planning-report.md`; the *principles* (own the
code, permissive license, a11y-first, small footprint) hold either way.

---

## 5. Key UI Surfaces to Design (informing component needs)

- **Workspace explorer** (file tree, pinned items, search).
- **Diff & approval surface** (side-by-side/inline diffs, per-hunk approve,
  bulk-change summary with deletions highlighted).
- **Action feed / audit view** (live, filterable, exportable timeline).
- **Permission & grants panel** (current mode, active grants, revoke).
- **Command approval modals** (with risk explanation).
- **Terminal panel** (user + agent-tagged output).
- **Provider/model config** (add key, validate, select model).
- **MCP panel** (servers, tools, allowlists, health).
- **Command palette** (keyboard-first navigation).
- **Session/chat** (secondary to the workspace, not the center).

---

## 6. Cross-Cutting UI Principles

- **Keyboard-first & accessible** (WCAG AA target); respect reduced-motion,
  high-contrast, and density preferences.
- **Progressive disclosure:** simple by default for non-coders; power surfaces on
  demand.
- **Transparency-forward:** always show current mode, what the agent is doing,
  and what it wants to do next.
- **No dark patterns around safety:** destructive confirmations are clear and
  never pre-checked.
- **Local rendering only:** no external UI CDNs, fonts, or telemetry pulled at
  runtime; everything bundled for offline/privacy.
