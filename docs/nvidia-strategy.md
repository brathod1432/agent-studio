# Agent Studio — NVIDIA Strategy

> Phase 12
> Status: Planning only. No implementation.
> Last updated: 2026-08-12

NVIDIA is intended as a **first-class citizen**. The bar: a user pastes an NVIDIA
API key, picks a model, and starts a session — in under a minute — with the same
control/audit guarantees as any other provider. This document should be
validated against current NVIDIA docs before implementation, as endpoints and
model catalogs evolve.

---

## 1. Why NVIDIA First-Class

- NVIDIA's hosted model endpoints (build.nvidia.com / NIM) expose an
  **OpenAI-compatible** API surface, so integration reuses the OpenAI-compatible
  adapter (`provider-architecture.md`) with minimal NVIDIA-specific glue.
- NVIDIA NIM microservices also enable **self-hosted / on-prem** deployments,
  which aligns perfectly with Agent Studio's local-first, enterprise-private
  positioning.
- Strong appeal to the engineering/enterprise/GPU-owning audience in our target
  personas.

## 2. Deployment Modes to Support

1. **Hosted (build.nvidia.com / cloud NIM):** user supplies an API key and base
   URL; models served by NVIDIA's cloud catalog.
2. **Self-hosted NIM (on-prem / local GPU):** user points to a locally or
   privately deployed NIM endpoint (often no external key; network-local). This
   is the privacy/enterprise sweet spot — data never leaves the org.

Both are the *same adapter* differing only in base URL and auth presence.

---

## 3. Architecture

```
Agent Engine ──▶ Provider Manager ──▶ NVIDIA adapter (OpenAI-compatible)
                                          │  base URL: hosted NIM | self-hosted NIM
                                          │  auth: API key (hosted) | none/local (on-prem)
                                          ▼
                                   NVIDIA NIM endpoint (cloud or on-prem)
```

- Implemented as a **thin specialization of the OpenAI-compatible adapter**:
  preset base URL(s), NVIDIA model catalog, capability metadata, and
  NVIDIA-specific error normalization.
- Tool/function calling, streaming, and context handling flow through the same
  normalized engine path; models lacking native tool-calling fall back to
  structured-output emulation via capability negotiation.
- No special-casing in the agent loop, permission gate, or audit — NVIDIA
  sessions get identical control/auditing.

---

## 4. User Experience (the "paste key → run" flow)

1. **Add NVIDIA provider:** a preset entry (logo, sensible default base URL for
   hosted). User pastes the API key (or selects "self-hosted" and enters the
   endpoint URL).
2. **Validate:** one-click connection + auth check with a clear result; on
   success, discover/curate the model list.
3. **Select model:** from discovered/curated NVIDIA models, with capability and
   (for hosted) cost hints.
4. **Start session:** open a workspace and go — same modes, previews, approvals,
   and audit as any provider.

UX details:
- Key stored in OS keychain via Identity Manager; shown redacted (last 4).
- Self-hosted path emphasizes "your data stays on your network."
- Helpful, specific errors (invalid key, endpoint unreachable, model not
  available, quota) rather than raw HTTP.

---

## 5. Security

- Key handling identical to all providers: OS keychain, redaction, never logged,
  never in workspace files, never brokered through Agent Studio infrastructure.
- Requests go **directly** to the configured NVIDIA endpoint.
- Self-hosted NIM keeps prompts/completions inside the user's network — a strong
  story for regulated data; document it explicitly.
- TLS verification enforced for hosted; for local endpoints, clear handling of
  self-signed/local TLS with explicit user opt-in (never silently disable
  verification).

---

## 6. Potential Limitations / Risks

- **Catalog churn:** NVIDIA's available models change; rely on discovery where
  possible and keep a curated fallback list updated per release.
- **OpenAI-compat gaps:** some models/endpoints may differ subtly (tool-calling
  formats, streaming quirks); capability probing and adapter-level shims handle
  these.
- **Rate limits / quotas (hosted):** normalize and surface clearly; wire to
  fallback models.
- **Self-hosted variability:** on-prem deployments differ in versions/features;
  validation + capability probe adapt the loop.
- **Docs drift:** endpoints/paths may change; isolate all NVIDIA specifics in the
  adapter so updates are localized.

---

## 7. Future Expansion

- **Deeper NIM integration:** support NVIDIA's broader microservice catalog
  (embeddings/retrieval, reranking, guardrails, multimodal) via the same
  provider/knowledge abstractions — e.g. local NIM embeddings for private
  workspace indexing (`workspace-model.md`).
- **On-prem enterprise packs:** documented reference setups for self-hosted NIM +
  Enterprise mode governance.
- **GPU-aware local model UX:** surface local NIM/GPU availability and model
  fit for power users.
- **Guardrails integration:** optionally route through NVIDIA guardrail services
  as an extra safety layer where the org requires it.

---

## 8. Success Criteria

- Time-to-first-successful-session after pasting an NVIDIA key: **< 1 minute**.
- Self-hosted NIM works with no external network egress.
- NVIDIA sessions are indistinguishable from other providers in control, audit,
  and reversibility guarantees.
