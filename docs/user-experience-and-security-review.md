# Agent Studio — User-Side Experience & Security Review

> Reviewer perspective: a real person installing Agent Studio and using the chat
> runtime day to day. Focus: practical usefulness + security/privacy.
> Grounded in the current code (Phase 1 onboarding + Phase 2 chat runtime).
> Last updated: 2026-08-12

---

## 1. Summary

Agent Studio already does the hard, unglamorous parts well: it is local-first,
provider-agnostic, has zero runtime dependencies, keeps secrets out of settings
and logs, and persists conversations as clean JSON you can read and resume. For
a first end-to-end runtime that is a genuinely strong foundation.

Where it falls short *for a real user* is the last mile of daily usability and a
few privacy gaps that matter once actual conversations and keys live on disk.
Today, to change the model you must hand-edit JSON or re-run onboarding; long
conversations will eventually break because the whole history is sent every turn;
`Ctrl+C` kills the app and loses the turn; token/cost is captured but never
shown; and anything you paste into chat (including a password or API key) is
written to disk in plaintext forever. None of these are hard to fix, and fixing
them is what turns this from "an impressive demo" into "a tool I reach for."

This report lists the improvements in priority order, then treats security and
privacy separately (as requested), and closes with a short, high-value quick-win
plan.

---

## 2. How a real user experiences it today

A quick honest walkthrough, with the friction points a first-time user hits.

1. `npm run onboard` — clear and safe. Friction: during model selection you have
   to *type* the model id from memory; the endpoint can already list models, so
   the wizard could show a pick-list instead.
2. `npm run chat` — works, streams replies, remembers and resumes. Friction:
   - No way to switch model/provider without leaving and editing config.
   - No `Ctrl+C` to stop a long answer; stopping means killing the process, and
     that turn is lost entirely (the question too).
   - No sense of cost — how many tokens/dollars a turn used.
   - Conversations accumulate with auto-titles from the first message only; no
     rename, delete, search, or export.
3. Coming back later — resume works well and history is intact. Friction: after
   many turns, requests get slower/pricier and will eventually fail, because the
   full transcript is re-sent every turn with no trimming.

The core loop is solid; the surrounding "quality of life" is what's missing.

---

## 3. Practical improvements (prioritized)

### P0 — Unlocks real daily use

| # | Improvement | Why it matters to a user | Notes on current state |
|---|---|---|---|
| P0-1 | **Change model/provider without editing JSON** — `/model`, `/provider` in chat, and an `agent-studio config` command to view/set. Offer a pick-list from the live `/models` response. | Changing model is the single most common thing a user wants; today it requires hand-editing `config`/settings or re-running onboarding. | CLI commands are only `help/new/list/resume/exit`. Model discovery already exists (`listModels`) but isn't reused for selection. |
| P0-2 | **Context-window management** — trim old turns and/or summarize, with a visible token counter and a configurable limit. | Without it, long chats get slow, expensive, and eventually error out. This is the difference between a toy and a tool. | Every turn sends the *entire* history (`ChatAgent.#buildMessages`). No trimming or summarization. |
| P0-3 | **Graceful cancel** — `Ctrl+C`/`Esc` stops streaming, keeps the partial answer, and still persists the turn. | Users abort long/wrong answers constantly; today that kills the app and loses the whole turn (including their question, since save happens only after completion). | No `SIGINT`/abort wiring in the chat loop; the user message is appended in memory but only saved post-reply. |
| P0-4 | **Token/cost visibility** — show per-turn and session token counts (and an optional spend estimate/cap). | People need to trust and budget their spend, especially on hosted providers. | `usage` (prompt/completion/total tokens) is already parsed into `ChatResponse` but never displayed or stored. |

### P1 — Rounds out the experience

| # | Improvement | Why it matters |
|---|---|---|
| P1-1 | **Conversation management**: rename, delete, search, export to Markdown, pin/favorite; show storage location and size; a cleanup command. | Real usage produces many conversations; users need to find, tidy, and share them. Titles today are only auto-derived from the first message. |
| P1-2 | **One-shot / scripting mode**: `agent-studio ask "…"` (or `-m`) and clean stdin piping that prints just the answer. | Lets users compose the agent into scripts, git hooks, and pipelines — a big real-world multiplier. Piped chat works but is loop-oriented and prints UI chrome. |
| P1-3 | **Automatic retry with backoff** on transient errors (429/5xx/timeout), honoring `Retry-After`. | Hosted endpoints rate-limit and blip constantly; a single transient error shouldn't drop a turn. Errors are already classified as `retryable`/`retryAfterSeconds`, but chat doesn't retry. |
| P1-4 | **User-editable system prompt / personas** surfaced via `--persona`, `/system`, or config; plus "include a file in context." | This is the workspace-first promise — grounding the agent in the user's actual files/instructions instead of a fixed prompt. The prompt registry already supports overrides; it just isn't exposed. |
| P1-5 | **Onboarding polish**: pick model from a live list; offer a zero-key local start (Ollama/LM Studio) so users can try it without any API key. | Lowers the first-run barrier, especially for non-coders and the privacy-conscious. |
| P1-6 | **Web chat UI** reusing the engine over the existing local server. | Not everyone lives in a terminal; the onboarding web server already proves the pattern. |

### P2 — Nice-to-have / later

| # | Improvement | Why it matters |
|---|---|---|
| P2-1 | Input ergonomics: multi-line input, up-arrow history, copy last answer, regenerate, edit-and-resend. | Everyday comfort; matches what users expect from modern chat tools. |
| P2-2 | Multiple named provider profiles with quick switching (e.g., work vs personal keys). | Common real-world need; keeps keys and models organized. |
| P2-3 | Real cross-platform packaging so `agent-studio` runs as a signed binary. | The `bin` entry points at a `.ts` file that needs Node + TS loading; a normal user can't just run `agent-studio`. |
| P2-4 | Non-coder guidance and accessibility polish in first-run and errors. | Broadens the audience beyond developers, matching the product vision. |

---

## 4. Security & privacy improvements (user-facing)

The engine already does the fundamentals right: keys are stored by reference
(`env:NAME`) not value, `Secret` never serializes, logs are redacted, requests
go straight to the configured endpoint, conversation ids are validated against
path traversal, and there are zero third-party dependencies. The gaps below are
about what happens to *user data at rest* and to the *local web surface*.

### S-1 — Secrets/PII pasted into chat are persisted in plaintext (high, easy)
If a user pastes an API key, password, or personal data into a message, it is
written verbatim into `.agentstudio/conversations/<id>.json` (unencrypted,
forever) and sent to the provider. There is no detection, warning, or redaction
on user input. Recommendation: run inbound messages through a lightweight
secret/PII pattern check and either warn ("this looks like a key — store it?"),
redact before persisting, or offer a per-conversation "don't persist" mode. This
reuses the redaction machinery that already exists for logs.

### S-2 — Conversations and settings are unencrypted on disk (medium)
Anyone with read access to the user's profile can read every past conversation.
On Windows the `0o600` mode set when writing `.env.local` is effectively a no-op
(POSIX permission bits don't map to Windows ACLs). Recommendations, in order of
effort: (a) document clearly *where* data is stored and that it's plaintext;
(b) set restrictive ACLs per-OS; (c) offer optional at-rest encryption for
conversations; (d) move the API key itself into the OS keychain (already on the
roadmap) rather than `.env.local`.

### S-3 — Local web onboarding server lacks CSRF/rebinding defenses (medium)
The server correctly binds to loopback and checks the `Host` header, which is a
good start. But there is no per-session token, no `Origin` allowlist, and no CSRF
token. A malicious web page open in the user's browser could issue cross-origin
`POST`s to `http://127.0.0.1:4173/api/*` (CSRF) — reading the provider list or
writing settings, and in the worst case triggering a key write to `.env.local`.
DNS-rebinding can also defeat naive `Host` checks. Recommendations: generate a
random port and a one-time token printed to the console (require it as a header
or query param), validate `Origin` strictly against the known local origin, and
add a CSRF token to state-changing requests. Since this is local-only today the
risk is moderate, but it's cheap to harden now before a full web UI ships.

### S-4 — Silent config fallback hides tampering and mistakes (medium)
`store.ts` catches a bad `settings.json` and silently reverts to defaults;
`catalog.ts` reads provider/default JSON with a bare `JSON.parse` and no error
guard at all. Two concrete consequences a user will hit: (1) a settings file
saved by an editor that adds a UTF-8 BOM silently fails to parse and the app
quietly uses the *default* provider/endpoint with no warning — this actually
happened during testing; (2) a typo in `providers.json` crashes the CLI with a
raw stack trace. Recommendation: strip a BOM on read, validate the parsed shape,
and emit a clear, actionable message ("your settings file couldn't be read on
line X; using defaults") instead of silently reverting or crashing. Silent
reversion is also a subtle *safety* issue: a user who thinks they're pointed at a
private/local endpoint could unknowingly fall back to a public default.

### S-5 — Corrupted conversation files silently disappear (low–medium)
`readConversationFile` returns `undefined` on parse failure, so a damaged file
just drops out of `list()`/resume with no notice — it looks like data loss.
Recommendation: surface a warning, keep the raw file, and write atomically (temp
file + rename) so a crash mid-write can't corrupt an existing conversation.

### S-6 — Never add an "insecure TLS" toggle without explicit consent (preventive)
Default `fetch` verifies TLS today (good). If self-hosted/self-signed endpoints
are supported later, any option to skip verification must be per-use, explicit,
and loudly flagged — never a silent global switch.

### S-7 — Prompt-injection posture for the future (preventive)
Right now the agent only prints model text, so injection impact is low. As tools
arrive (file/terminal/MCP in later phases), untrusted model or file content must
never be able to trigger actions on its own — the permission gate in the planning
docs must stay the hard boundary. Worth keeping visible so it isn't lost.

---

## 5. Concrete bugs/robustness issues found (grounded in code)

1. **BOM / malformed config** — `catalog.ts:readJson` has no `try/catch` and no
   BOM handling; `store.ts` silently falls back to defaults on any parse error.
   Net effect: hand-edited config can crash the CLI (catalog) or silently not
   apply (settings). *Observed during testing (BOM).*
2. **Cancel loses the turn** — no `SIGINT`/abort handling in the chat loop; the
   user message is only saved after a full reply, so aborting loses the question
   too.
3. **Token usage unused** — `usage` is parsed and typed but never shown or
   persisted.
4. **Corrupted conversation is invisible** — parse failure silently removes it
   from listing/resume; writes are not atomic.
5. **`bin` isn't runnable as a plain command** — it targets a `.ts` file that
   requires Node's TS loader; a normal install won't give a working
   `agent-studio` executable.

---

## 6. Recommended quick wins (high value, low effort)

If the goal is the biggest jump in real-world usefulness for the least work, do
these first:

1. `/model` + `agent-studio config` to change model/provider without editing JSON
   (P0-1) — reuse existing `listModels`.
2. Show per-turn and session token counts (P0-4) — the data is already captured.
3. `Ctrl+C` cancel that keeps the partial answer and persists the turn (P0-3).
4. BOM-safe, validated config loading with a clear warning instead of silent
   fallback or crash (S-4).
5. Warn before persisting a message that looks like a secret (S-1) — reuse the
   redaction machinery.

Each is small, self-contained, testable with the existing mock provider, and
directly removes a friction or risk a real user will hit in the first hour.

---

## 7. What is already good (keep it)

Worth stating plainly so it isn't lost in a list of gaps: local-first with no
mandatory network or telemetry; provider-agnostic with NVIDIA/OpenAI-compatible
first-class; zero runtime dependencies (excellent supply-chain posture); secrets
stored by reference and never logged or serialized; conversations as portable,
human-readable JSON with auto-save and resume; and a clean engine/clients split
that makes every improvement above straightforward to add without rework.

---

## 8. Real-life use cases: who uses this, and what's blocking them

The fastest way to judge usefulness is to walk through concrete people trying to
get real work done. Each row is a realistic scenario, the value Agent Studio
gives *today*, and the specific gap that stops it from being a daily driver.

### Developer (primary audience)
- **Wants:** explain code, draft snippets, rubber-duck a bug, review a diff.
- **Real-life flow:** `git diff | agent-studio ask "review this for bugs"`, or
  paste a file and ask for a refactor.
- **Blocked by:** no one-shot `ask`/piping that prints just the answer; no
  `@file` to pull a file into context; no quick model switch (cheap model for
  trivial questions, strong model for hard ones); long sessions eventually break.

### DevOps / SRE
- **Wants:** summarize a log dump, draft an incident timeline, sanity-check a
  config, generate a runbook.
- **Real-life flow:** pipe logs in, keep everything on-box because infra data is
  sensitive.
- **Blocked by:** no local-model quickstart (Ollama/self-hosted NIM) for
  "nothing leaves this machine"; no ephemeral `--no-save` mode; no retry on flaky
  VPN/network; no cancel when an answer goes the wrong way.

### Data analyst / knowledge worker
- **Wants:** summarize a document, extract structured points, draft a report.
- **Blocked by:** can't attach a file/context; no export to Markdown to drop the
  result into their deliverable; no personas ("answer as a concise analyst").

### Technical writer
- **Wants:** draft and edit docs in a consistent voice.
- **Blocked by:** no editable system prompt/persona (their style guide), no
  edit-and-resend, no export.

### Support / success engineer
- **Wants:** turn a rough note into a polished customer reply, reuse templates.
- **Blocked by:** no prompt library, no `/copy` of the last answer, no fast model
  switch for cost control on high volume.

### Privacy-conscious / enterprise user
- **Wants:** use AI without any data leaving their machine or org.
- **Value today:** local-first, provider-agnostic, no telemetry — a real strength.
- **Blocked by:** conversations stored unencrypted; no `--no-save` ephemeral mode;
  no clear "where is my data / what's stored" answer; local-model onboarding not
  surfaced; web onboarding server not yet CSRF-hardened (see S-3).

### Automation / CI user
- **Wants:** call the agent from a script or pipeline deterministically.
- **Blocked by:** no `--json` output, no stable exit codes, no way to pin
  temperature to 0 for reproducibility.

### Student / learner
- **Wants:** cheap, exploratory Q&A, and to look things up later.
- **Blocked by:** no cost visibility, no conversation search, no cheap-model
  default guidance.

The pattern across all of them: the engine can already *do* the core work; what's
missing is **input flexibility (files/pipes), output flexibility (export/copy/
json), control (model/params/cancel/cost), and a local-only path** for sensitive
use. Those four themes are where "useful in real life" actually lives.

---

## 9. Additional improvements (surfaced by the use-case lens)

These are beyond Section 3 and come directly from the scenarios above.

| # | Improvement | Primary users it unblocks |
|---|---|---|
| A-1 | `@file` / attach-a-file to pull workspace content into context | Developer, analyst, writer |
| A-2 | Per-session generation params (`/set temperature`, max tokens) with a deterministic mode | Automation, developer |
| A-3 | `--no-save` / ephemeral conversations (nothing written to disk) | Privacy, SRE |
| A-4 | `/export <md>`, `/copy`, `/regenerate`, `/edit` last message | Writer, support, analyst |
| A-5 | Conversation branching/fork ("try a different direction from here") | Developer, writer |
| A-6 | Tags/folders + search across conversations | Everyone with volume |
| A-7 | In-chat `/doctor` and `/privacy` (shows where data is stored + what's saved) | Privacy, support |
| A-8 | `--json` output + stable exit codes | Automation/CI |
| A-9 | Auto-detect a running local model (Ollama) and offer it in onboarding | Privacy, SRE, students |
| A-10 | `NO_COLOR`/quiet mode and screen-reader-friendly streaming | Accessibility, scripting |
| A-11 | Secret-free settings export/import for sharing setups across a team | Enterprise |

---

## 10. Additional security & privacy items (from the same lens)

Extending Section 4 with points that only appear once you picture real users on
shared or sensitive machines.

- **Denial-of-wallet / runaway cost.** A confused loop or a very long context can
  quietly burn money on hosted providers. Add a per-session spend/turn cap and a
  "this call is large — continue?" confirmation. This is both a cost and a trust
  control.
- **Ephemeral mode as a privacy primitive.** For sensitive questions, users need
  a guaranteed "don't write this to disk" mode (A-3). Today everything persists.
- **Data lifecycle controls.** Provide retention/auto-expiry and an
  `agent-studio purge` command so old conversations don't accumulate sensitive
  content indefinitely.
- **Info disclosure via settings.** `settings.json` can contain internal/private
  base URLs (e.g., a self-hosted NIM address). Keep it out of any export by
  default and document that the data dir is sensitive.
- **Web server hardening details.** Beyond S-3: send hardening headers
  (`X-Content-Type-Options: nosniff`, a strict `Content-Security-Policy`),
  avoid auto-opening a browser to a privileged local URL, and keep connections
  short-lived to shrink the DNS-rebinding window.
- **Clipboard hygiene.** If `/copy` is added, never leave secret-looking content
  on the clipboard longer than necessary, and don't auto-copy provider errors.
- **Debug logging discipline.** Ensure no debug path ever logs the full request
  body or headers; keep the existing redaction on and cap any provider error text
  echoed into diagnostics.

---

## 11. The "useful in real life" bar

If the aim is the smallest set of changes that turns this from an impressive
runtime into something a person genuinely reaches for daily, it is the
intersection of the four themes from Section 8:

1. **Input:** one-shot `ask` + stdin piping + `@file` context.
2. **Output:** `/export` and `/copy` (and `--json` for scripts).
3. **Control:** `/model` switch, token/cost display, `Ctrl+C` cancel.
4. **Local-only path:** Ollama/self-hosted quickstart + `--no-save` ephemeral mode.

That bundle is small, mostly built on primitives that already exist (model
discovery, usage parsing, the engine/clients split, conversation store), and it
directly serves every persona above. Everything else in this report is valuable
but secondary to crossing this bar.
