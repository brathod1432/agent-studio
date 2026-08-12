# Agent Studio — Provider Architecture

> Phase 11
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

Agent Studio is **provider-agnostic** by design. Providers are pluggable behind a
common interface; no provider is privileged in the core (though NVIDIA gets
first-class UX per `nvidia-strategy.md`). This mirrors the proven approach of
OpenCode (AI-SDK abstraction) and Continue.

---

## 1. Goals

1. **Neutrality:** add/remove providers without touching the agent engine.
2. **Local-first & private:** keys and requests go directly from the user's
   machine to the configured endpoint; never through Agent Studio infrastructure.
3. **Capability-aware:** the engine adapts to each model's features
   (tool/function calling, streaming, context window, vision, JSON mode).
4. **Resilient:** validation, retries, timeouts, and fallback models.
5. **Cost-aware:** token/cost accounting and budget caps surfaced to the user.

---

## 2. Supported Providers (target set)

First-class in early versions: **NVIDIA NIM, OpenAI, Anthropic, Ollama, generic
OpenAI-compatible.** Additional (phased): **Gemini, Azure OpenAI, OpenRouter,
LM Studio, custom endpoints.**

| Provider | Auth | Endpoint style | Notes |
|---|---|---|---|
| **NVIDIA NIM / build.nvidia.com** | API key | OpenAI-compatible | First-class (`nvidia-strategy.md`) |
| **OpenAI** | API key | OpenAI native | Reference implementation |
| **Anthropic** | API key | Anthropic Messages | Tool use / streaming |
| **Google Gemini** | API key | Gemini API | Distinct schema |
| **Azure OpenAI** | API key + resource/deployment | Azure OpenAI | Deployment-name routing |
| **OpenRouter** | API key | OpenAI-compatible | Multi-model gateway |
| **Ollama** | none (local) | Ollama / OpenAI-compat | Local models |
| **LM Studio** | none (local) | OpenAI-compatible | Local server |
| **Custom OpenAI-compatible** | optional key | OpenAI-compatible | Base URL + model id |
| **Local models (generic)** | varies | varies | via one of the above |

**Leverage:** most providers expose an **OpenAI-compatible** surface, so a solid
OpenAI-compatible adapter covers NVIDIA NIM, OpenRouter, LM Studio, Ollama
(compat mode), and arbitrary custom endpoints. Anthropic and Gemini get dedicated
adapters for their native schemas.

---

## 3. Provider Interface (conceptual)

A provider adapter implements a stable interface; the engine only knows this
interface:

```
Provider {
  id, displayName
  authSchema()                      // what credentials are needed
  validate(credentials) -> health   // connectivity + auth check
  listModels() -> [ModelInfo]        // discovery (or curated fallback list)
  capabilities(modelId) -> Caps      // tools, streaming, ctx window, vision, json
  chat(request, {stream}) -> events  // unified request/response + tool calls
  usage(response) -> {tokens, costEstimate}
  normalizeError(err) -> ProviderError
}
```

- **Unified request/response:** the engine speaks one internal message + tool-call
  format; adapters translate to/from each vendor schema (like an AI SDK).
- **Streaming:** adapters emit a normalized event stream (tokens, tool-call
  deltas, finish) consumed by the agent loop and forwarded to clients (SSE).
- **Tool/function calling:** normalized tool-call schema; adapters map to
  native function-calling or emulate via structured output where a model lacks
  native tools (capability negotiation).

---

## 4. Authentication & Secret Handling

- Keys entered by the user are stored via **Identity Manager** in the OS keychain
  (Keychain / DPAPI / libsecret), **never** in plaintext config or the workspace.
- Keys are **redacted** everywhere in logs/audit/UI (show last 4).
- Per-workspace provider/account scoping so different projects can use different
  keys/providers (e.g. an enterprise Azure key for work, a personal key for
  side projects).
- Local providers (Ollama/LM Studio) need no key; only a base URL.
- Requests go **directly** to the configured endpoint; Agent Studio operates no
  proxy or key-brokering service (a hard product boundary).

---

## 5. Connection Validation

On adding/editing a provider account:
1. **Auth + reachability check** (lightweight call) → clear success/failure with
   actionable error (bad key, network, wrong base URL, CORS/TLS).
2. **Model discovery** (if the endpoint supports listing) or a curated fallback
   catalog for providers without a discovery API.
3. **Capability probe** (best-effort): confirm tool-calling/streaming support so
   the engine configures the loop correctly.
4. Result cached in app storage; re-validated on demand and on failure.

---

## 6. Model Discovery & Selection

- Dynamic discovery where APIs allow; otherwise maintained catalogs updated with
  releases.
- Model metadata: context window, modality (text/vision), tool support, cost per
  token, recommended use.
- **Selection UX:** choose provider account → model; show capabilities and
  rough cost; per-workspace default; per-session override.
- Warn when a chosen model lacks a capability the task needs (e.g. no tool
  calling for Agent mode) and suggest alternatives.

---

## 7. Fallback & Routing

- **Fallback models:** ordered fallbacks per role (e.g. primary → cheaper/faster
  backup) triggered by errors, rate limits, or context-length overflow.
- **Role-based routing (future):** different models for different agent roles
  (planner vs coder vs summarizer) — see `multi-agent-strategy.md`.
- Fallback events are surfaced and audited (the user always knows which model
  actually served a turn).

---

## 8. Cost & Usage Awareness

- Per-request token counts and cost estimates; per-session and per-workspace
  aggregates.
- **Budget caps:** optional per-session/workspace spend limits; Autonomous mode
  requires a spend cap. Exceeding a cap pauses and asks (fail-safe).
- Cost is part of the audit record (which model, tokens in/out, estimated cost).
- Local models report zero external cost (surface compute/latency instead).

---

## 9. Reliability

- Timeouts, bounded exponential-backoff retries on transient errors, and
  rate-limit handling (respect `Retry-After`).
- Normalized error taxonomy (auth, rate-limit, context-overflow, network,
  server, content-filter) so the engine and UI respond appropriately.
- Streaming cancellation wired to the global Stop control.

---

## 10. Extensibility

- Providers are **extensions** (per `architecture-options.md`): third parties can
  ship an adapter implementing the interface and declaring required
  secrets/permissions.
- Built-in adapters (OpenAI-compatible, Anthropic, Gemini, Azure) ship in-core
  behind the same interface, so extraction to the extension system is mechanical.
- Version/capability negotiation keeps old adapters working as the internal
  message format evolves.

---

## 11. Out of Scope (v1)

- Hosting/serving/fine-tuning models.
- A universal cost-optimization router (basic fallback only in v1).
- Automatic provider selection without user consent.
