# Agent Studio — Project Notes

## Overview
Planning docs live in `docs/`. The first implemented slice is the **provider
configuration system + provider testing + first-run onboarding + secure secret
handling**, built as an engine (`src/engine`) with thin clients
(`src/clients/cli`, `src/clients/web`).

## Runtime
- **Node.js >= 22.6** (uses native TypeScript type-stripping, `node --test`,
  `--env-file-if-exists`, global `fetch`). **Zero runtime dependencies.**
- Dev-only (optional) `typescript` + `@types/node` for `npm run typecheck`.

## Commands
```
npm test        # run all tests (node --test over src/**/*.test.ts, HTTP mocked)
npm run onboard # interactive CLI first-run wizard (steps 1-5)
npm run chat    # interactive conversational agent (Phase 2)
npm run doctor  # provider health check on the active config (live call)
npm run serve   # local (loopback-only) web onboarding at http://127.0.0.1:4173
npm run typecheck  # requires devDependencies installed
```
CLI chat commands: `/help`, `/new`, `/list`, `/resume`, `/exit`.

## Agent runtime (Phase 2)
- `src/engine/llm/` — `LLMClient` abstraction, OpenAI-compatible chat client
  (chat + SSE streaming), `NvidiaClient`, and a factory
  (`createLLMClient` / `createLLMClientFromSettings`). Provider-agnostic; the
  NVIDIA client is config-driven (no hardcoded URL/model).
- `src/engine/memory/` — JSON conversation persistence under
  `.agentstudio/conversations/<id>.json` (no DB, no deps) + `ConversationStore`
  (new/resume/append/list; auto-saved by the agent after each assistant reply).
- `src/engine/prompts/` — `PromptTemplate` + `PromptRegistry` loading `.md`
  templates from `prompts/defaults/` (override dir via `AGENT_STUDIO_PROMPTS_DIR`).
- `src/engine/agents/` — `Agent` interface + `ChatAgent`
  (load memory → append user → call LLM → append assistant → persist → return).
Also: `node src/clients/cli/index.ts status` shows current config (secret-safe).

## Testing against a provider endpoint
Two ways to exercise the runtime end-to-end:

**A. Real NVIDIA** (needs outbound network to `integrate.api.nvidia.com`):
1. Put a valid key in `.env.local` as `NVIDIA_API_KEY`.
2. `npm run doctor` — confirms auth + lists models + validates the configured model.
3. `npm run chat` — new/resume sessions with streamed replies.
   If the default model id isn't in your account's catalog, `doctor` lists the
   available ones; pick one via `npm run onboard` or edit `config/default.json`.

**B. Local mock (no network needed)** — `tools/mock-provider/server.ts` is a
zero-dep OpenAI-compatible server (`/v1/models`, `/v1/chat/completions`, bearer
auth, SSE streaming). It rejects the token `INVALID` (401) and unknown models
(404) so error paths can be exercised.
```
npm run mock                                   # starts on http://127.0.0.1:4321/v1
# point the app at it via an isolated data dir + a settings.json whose
# provider baseUrl = http://127.0.0.1:4321/v1 (simulates self-hosted NIM):
$env:AGENT_STUDIO_DATA_DIR = "$env:TEMP\as-local"   # isolate from real config
npm run doctor
npm run chat
```
`AGENT_STUDIO_DATA_DIR` overrides where settings + conversations are stored
(handy for isolated testing). Non-interactive/piped input into `chat` is
supported (line-buffered; `/exit` or EOF ends the session).

## Configuration (no hardcoded model)
- `config/providers.json` — provider presets (NVIDIA is the default dev provider,
  base URL `https://integrate.api.nvidia.com/v1`, default model
  `nvidia/nemotron-3.5-lightning-30b-a3b`).
- `config/default.json` — default active provider + model + request settings.
- User settings persist to `.agentstudio/settings.json` (git-ignored).
- Override config/data locations via `AGENT_STUDIO_CONFIG_DIR` /
  `AGENT_STUDIO_DATA_DIR`. Web port via `AGENT_STUDIO_WEB_PORT`.

## Secret handling (rules)
- The NVIDIA key lives in `.env.local` as `NVIDIA_API_KEY` (git-ignored).
- Settings store only an `apiKeyRef` (e.g. `env:NVIDIA_API_KEY`) — **never** the
  key value. `saveSettings` strips any leaked key fields.
- `Secret` wrapper + `maskSecret` + redacting `Logger` ensure the key is never
  logged, printed in full, or serialized. Always use the engine `logger`.

## Structure
```
config/                     provider presets + defaults (editable, no code changes)
src/engine/core/            paths, secrets, redact, logger, envFile
src/engine/config/          types, catalog loader, settings store (+ first-run)
src/engine/providers/       types, errors, openai-compatible adapter, factory, testing, diagnostics
src/engine/onboarding/      onboarding state machine (steps 1-5, shared by clients)
src/clients/cli/            CLI wizard + doctor/status
src/clients/web/            loopback-only web onboarding server + public/onboard.html
src/testkit/                mock fetch helpers for tests
```

## Polyglot: Python 3.12 runtime (`src/py/agent_studio`)
The project is intentionally polyglot — a TypeScript orchestration layer plus a
first-class **Python 3.12 runtime**. Both are **dependency-free at runtime**
(TS = zero npm deps; Python = standard library only) and share the same on-disk
formats, so a conversation created by one is readable/resumable by the other.

- **Layout:** `src/py/agent_studio/{core,config,llm,memory,providers,tools,rpc,cli}`,
  tests in `src/py/tests`. Packaging: `pyproject.toml` (`requires-python >=3.12`,
  no runtime deps). Every module uses `from __future__ import annotations` for
  forward compatibility.
- **What it does:** its own OpenAI-compatible client (Ollama + NVIDIA) with
  streaming/retry/usage, JSON conversation store (identical schema to TS),
  ChatAgent (context trim + usage + cancel), a **tools/skills** layer
  (`code.analyze` via `ast`, `text.stats/summarize`, `data.csv_to_json/json_query`,
  `diff.unified`, `report.markdown`, `fs.summarize`), and a full CLI
  (`ask`/`chat`/`doctor`/`status`/`config`/`tools`).
- **Interop:** a stdio JSON-RPC **tool host** (`python -m agent_studio.rpc.host`,
  methods `ping`/`tools/list`/`tools/call`, MCP-adjacent) is driven by the TS
  engine via `src/engine/bridge/pythonBridge.ts` — Python runs as a
  process-isolated, least-privilege extension.

### Python commands
```
npm run test:py        # python -m unittest (stdlib; from src/py)
npm run test:all       # TS suite + Python suite
npm run py -- doctor   # python -m agent_studio <cmd>  (ask/chat/doctor/config/tools)
npm run lint:py        # ruff (dev-only)
npm run typecheck:py   # mypy --strict (dev-only)
# direct: cd src/py && python -m agent_studio ask "hello"
```
Dev-only Python tooling (`ruff`, `mypy`) is optional (`pip install -e ".[dev]"`),
mirroring how TS `typecheck` needs dev deps. `docker/` has Node + Python images
and an Ollama compose stack (authored/validated; build where Docker is available).
