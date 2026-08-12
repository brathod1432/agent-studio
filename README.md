# Agent Studio

A local-first, provider-agnostic AI agent workspace. Agent Studio lets you
configure an LLM provider (NVIDIA, OpenAI, Anthropic, Ollama, or any
OpenAI-compatible endpoint), then chat with a conversational agent whose history
is remembered and persisted locally — with a strong focus on user control,
security, and zero runtime dependencies.

> Status: early development. Phase 1 (provider config + onboarding) and Phase 2
> (conversational agent runtime) are implemented and tested. See `docs/` for the
> full product vision, architecture, and roadmap.

## Highlights

- **Local-first & private** — runs fully offline against local models; no
  telemetry; your data and keys stay on your machine.
- **Provider-agnostic** — NVIDIA NIM (default), OpenAI, Anthropic (config only),
  Ollama, and any OpenAI-compatible endpoint. No hardcoded models or URLs.
- **Zero runtime dependencies** — pure Node.js (native `fetch`, `node:test`,
  TypeScript type-stripping). Only optional dev tooling for type-checking.
- **Secure by default** — API keys are stored by reference (never written to
  settings or conversations), never logged, and never serialized.
- **Conversation memory** — chats are saved as human-readable JSON you can
  resume, list, and inspect.

## Requirements

- **Node.js >= 22.6** (uses native TypeScript execution, the built-in test
  runner, and `--env-file` support). Check with `node --version`.
- No `npm install` is required to run or test the app. Dev dependencies
  (`typescript`, `@types/node`) are only needed for `npm run typecheck`.

## Quick start

```bash
# 1. Clone
git clone https://github.com/brathod1432/agent-studio.git
cd agent-studio

# 2. Add your API key (this file is git-ignored and never committed)
cp .env.example .env.local
#   then edit .env.local and set NVIDIA_API_KEY=...   (or another provider's key)

# 3. Configure a provider (interactive wizard)
npm run onboard

# 4. Verify connectivity + auth + model
npm run doctor

# 5. Chat
npm run chat
```

On Windows PowerShell the same `npm run ...` commands work. If `npm` scripts are
inconvenient, you can call the CLI directly, e.g.
`node --env-file-if-exists=.env.local src/clients/cli/index.ts chat`.

## Commands

| Command | What it does |
|---|---|
| `npm run onboard` | Interactive first-run wizard: choose provider, enter key, pick model, test, save |
| `npm run chat` | Conversational agent: new/resume sessions, streamed replies, auto-save |
| `npm run doctor` | Health check on the active provider (connection, auth, model validation) |
| `npm run serve` | Local (loopback-only) web onboarding UI at `http://127.0.0.1:4173` |
| `npm run mock` | Start a local OpenAI-compatible mock provider for offline testing |
| `npm test` | Run the full automated test suite (HTTP is mocked; no real API calls) |
| `npm run typecheck` | Type-check with `tsc` (requires `npm install` of dev deps) |

In-chat commands: `/help`, `/new`, `/list`, `/resume`, `/exit`.

## Configuration (nothing hardcoded)

Providers and defaults are data, not code:

- `config/providers.json` — provider presets (endpoints, default models, which
  env var holds each key). NVIDIA is the default development provider.
- `config/default.json` — default active provider, default model, request
  timeouts/retries.
- Your saved settings are written to `.agentstudio/settings.json` (git-ignored).
  Settings store only an `apiKeyRef` like `env:NVIDIA_API_KEY` — never the key.

Useful environment overrides:

- `AGENT_STUDIO_CONFIG_DIR` — where provider/default config is read from.
- `AGENT_STUDIO_DATA_DIR` — where settings + conversations are stored.
- `AGENT_STUDIO_PROMPTS_DIR` — override the prompt templates directory.
- `AGENT_STUDIO_WEB_PORT` — port for the web onboarding UI.

## Testing without a network / API key

The repo includes a zero-dependency, loopback-only mock that speaks the
OpenAI-compatible protocol (`/v1/models`, `/v1/chat/completions`, bearer auth,
SSE streaming), so you can exercise the whole flow offline:

```bash
npm run mock        # starts http://127.0.0.1:4321/v1
```

Point an isolated config at it (see `AGENTS.md` for the exact steps) and run
`doctor` / `chat` against the mock. The mock rejects the token `INVALID` (401)
and unknown models (404) so error paths can be tested too.

## Security & privacy

- API keys live only in `.env.local` (git-ignored) and are referenced by name;
  they are never written to settings, conversation files, logs, or source.
- A redacting logger and a `Secret` wrapper prevent accidental key exposure.
- Requests go directly to the endpoint you configure — nothing is proxied.
- Conversations are stored locally as plaintext JSON under `.agentstudio/`;
  treat that directory as sensitive. See
  `docs/user-experience-and-security-review.md` for known gaps and hardening
  recommendations.

## Project structure

```
config/                     Provider presets + defaults (editable; no code changes)
src/engine/                 Core engine (provider-agnostic, no client/UI code)
  core/                     paths, secrets, redaction, logging, http, env-file
  config/                   settings types, catalog loader, store (first-run)
  providers/                provider interface, errors, OpenAI-compatible adapter
  llm/                      LLM client abstraction + factory + provider clients
  memory/                   conversation types, JSON persistence, store/sessions
  prompts/                  prompt template + registry + defaults/
  agents/                   Agent interface + ChatAgent
src/clients/cli/            CLI (onboard, chat, doctor, status)
src/clients/web/            Local web onboarding server + page
tools/mock-provider/        Offline OpenAI-compatible mock server
docs/                       Product vision, architecture, security, roadmap, reviews
AGENTS.md                   Guide for AI agents / new Devin sessions working here
```

## Documentation

Start with `AGENTS.md` (commands, layout, testing) and `docs/`:

- `docs/vision.md`, `docs/roadmap.md`, `docs/final-planning-report.md` — product direction
- `docs/architecture-options.md`, `docs/core-modules.md` — architecture
- `docs/provider-architecture.md`, `docs/nvidia-strategy.md`, `docs/mcp-strategy.md` — integrations
- `docs/security-review.md`, `docs/permission-model.md`, `docs/audit-model.md` — security & control
- `docs/user-experience-and-security-review.md` — practical, user-side improvement report

## Contributing

See `CONTRIBUTING.md`. In short: keep the engine dependency-free, never hardcode
providers/models/endpoints/secrets, add tests (mock the network), and run
`npm test` before committing.

## License

[MIT](LICENSE) © brathod1432
