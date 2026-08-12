// OpenAI-compatible provider adapter. Covers NVIDIA NIM, OpenAI, Ollama,
// LM Studio, OpenRouter, and any custom OpenAI-compatible endpoint via base URL.

import type { ProviderConfig } from '../config/types.ts';
import { errorFromStatus, errorFromThrown, missingApiKey, ProviderError } from './errors.ts';
import type {
  CheckResult,
  ConnectionTestResult,
  FetchLike,
  ModelInfo,
  Provider,
  ProviderRuntimeContext,
} from './types.ts';

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${b}/${p}`;
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class OpenAICompatibleProvider implements Provider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  #resolveFetch(ctx: ProviderRuntimeContext): FetchLike {
    const impl = ctx.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!impl) throw new ProviderError({ kind: 'invalid_config', message: 'No fetch implementation available.', retryable: false });
    return impl;
  }

  #authHeaders(ctx: ProviderRuntimeContext): Record<string, string> {
    if (ctx.apiKey) return { Authorization: `Bearer ${ctx.apiKey}` };
    return {};
  }

  #validateConfig(): CheckResult {
    if (!this.config.baseUrl) {
      return { name: 'config', status: 'error', message: 'Base URL is not configured for this provider.' };
    }
    try {
      const u = new URL(this.config.baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return { name: 'config', status: 'error', message: `Base URL must use http/https (got ${u.protocol}).` };
      }
    } catch {
      return { name: 'config', status: 'error', message: `Base URL is not a valid URL: ${this.config.baseUrl}` };
    }
    return { name: 'config', status: 'ok', message: `Base URL looks valid (${this.config.baseUrl}).` };
  }

  async listModels(ctx: ProviderRuntimeContext): Promise<ModelInfo[]> {
    const fetchImpl = this.#resolveFetch(ctx);
    const url = joinUrl(this.config.baseUrl, 'models');
    let res: Response;
    try {
      res = await fetchWithTimeout(
        fetchImpl,
        url,
        { method: 'GET', headers: { Accept: 'application/json', ...this.#authHeaders(ctx) } },
        ctx.request.timeoutMs,
      );
    } catch (err) {
      throw errorFromThrown(err);
    }
    if (!res.ok) {
      let bodyHint: string | undefined;
      try {
        bodyHint = (await res.text()).slice(0, 200);
      } catch {
        bodyHint = undefined;
      }
      throw errorFromStatus(res.status, res.headers, bodyHint);
    }
    const data = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string; owned_by?: string }> };
    const list = Array.isArray(data.data) ? data.data : [];
    return list
      .filter((m) => typeof m.id === 'string')
      .map((m) => ({ id: m.id as string, ownedBy: m.owned_by }));
  }

  async testConnection(ctx: ProviderRuntimeContext): Promise<ConnectionTestResult> {
    const checks: CheckResult[] = [];

    // 1. Config check.
    const configCheck = this.#validateConfig();
    checks.push(configCheck);
    if (configCheck.status === 'error') {
      return {
        ok: false,
        status: 'error',
        checks,
        error: new ProviderError({ kind: 'invalid_config', message: configCheck.message, retryable: false }),
      };
    }

    // 2. API key presence check (only if this provider references a key).
    const needsKey = Boolean(this.config.apiKeyRef);
    if (needsKey && !ctx.apiKey) {
      const envName = this.config.apiKeyRef?.replace(/^env:/, '');
      const err = missingApiKey(envName);
      checks.push({ name: 'api_key', status: 'error', message: err.message });
      return { ok: false, status: 'error', checks, error: err };
    }
    checks.push({
      name: 'api_key',
      status: needsKey ? 'ok' : 'warn',
      message: needsKey ? 'API key is present.' : 'No API key required for this provider.',
    });

    // 3. Reachability + auth via model listing.
    const start = (ctx.now ?? Date.now)();
    let models: ModelInfo[];
    try {
      models = await this.listModels(ctx);
    } catch (err) {
      const perr = errorFromThrown(err);
      checks.push({ name: 'connection', status: 'error', message: perr.message, detail: { kind: perr.kind, status: perr.status } });
      return { ok: false, status: 'error', checks, error: perr, latencyMs: (ctx.now ?? Date.now)() - start };
    }
    const latencyMs = (ctx.now ?? Date.now)() - start;
    checks.push({
      name: 'connection',
      status: 'ok',
      message: `Connected successfully in ${latencyMs}ms. Discovered ${models.length} model(s).`,
      detail: { latencyMs, modelCount: models.length },
    });

    return { ok: true, status: 'ok', checks, models, latencyMs };
  }
}
