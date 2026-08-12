// High-level provider testing: connection test, model validation, and an
// aggregate health check. Resolves the API key from the environment via the
// config's apiKeyRef; the key value is never logged or returned.

import type { ProviderConfig } from '../config/types.ts';
import { maskSecret, resolveSecret } from '../core/secrets.ts';
import { registerSecretValue } from '../core/redact.ts';
import { createProvider } from './factory.ts';
import type {
  CheckResult,
  ConnectionTestResult,
  FetchLike,
  ModelInfo,
} from './types.ts';
import type { RequestSettings } from '../config/types.ts';

export interface HealthCheckOptions {
  request?: RequestSettings;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

const DEFAULT_REQUEST: RequestSettings = { timeoutMs: 30000, maxRetries: 2, retryBaseDelayMs: 500 };

export interface HealthReport {
  provider: {
    id: string;
    label: string;
    kind: string;
    baseUrl: string;
    model: string;
    /** Masked representation of the API key (never the real value). */
    apiKeyMasked: string;
    apiKeyEnv?: string;
  };
  overall: 'ok' | 'warn' | 'error';
  checks: CheckResult[];
  models?: ModelInfo[];
  latencyMs?: number;
}

/** Validate that the configured model exists among discovered models. */
export function validateModel(modelId: string, models: ModelInfo[] | undefined): CheckResult {
  if (!modelId) {
    return { name: 'model', status: 'error', message: 'No model is configured.' };
  }
  if (!models || models.length === 0) {
    return {
      name: 'model',
      status: 'warn',
      message: `Could not verify model "${modelId}" (the endpoint did not return a model list).`,
    };
  }
  const found = models.some((m) => m.id === modelId);
  if (found) {
    return { name: 'model', status: 'ok', message: `Model "${modelId}" is available.` };
  }
  const sample = models.slice(0, 5).map((m) => m.id).join(', ');
  return {
    name: 'model',
    status: 'warn',
    message: `Model "${modelId}" was not found in the endpoint's list. Available (sample): ${sample}${
      models.length > 5 ? ', …' : ''
    }`,
    detail: { available: models.length },
  };
}

/** Run only the connection test (reachability + auth). */
export async function testConnection(
  config: ProviderConfig,
  opts: HealthCheckOptions = {},
): Promise<ConnectionTestResult> {
  const env = opts.env ?? process.env;
  const resolved = resolveSecret(config.apiKeyRef, env);
  if (resolved.present && resolved.secret) registerSecretValue(resolved.secret.reveal());
  const provider = createProvider(config);
  return provider.testConnection({
    apiKey: resolved.secret?.reveal(),
    request: opts.request ?? DEFAULT_REQUEST,
    fetchImpl: opts.fetchImpl,
    now: opts.now,
  });
}

/** Full health check: config + key + connection + model validation. */
export async function healthCheck(
  config: ProviderConfig,
  opts: HealthCheckOptions = {},
): Promise<HealthReport> {
  const env = opts.env ?? process.env;
  const resolved = resolveSecret(config.apiKeyRef, env);
  const apiKeyEnv = config.apiKeyRef?.replace(/^env:/, '');

  const conn = await testConnection(config, opts);
  const checks = [...conn.checks];

  // Model validation only runs meaningfully once we could connect.
  if (conn.ok) {
    checks.push(validateModel(config.model, conn.models));
  } else {
    checks.push({
      name: 'model',
      status: 'warn',
      message: `Model "${config.model || '(none)'}" not validated because the connection test did not succeed.`,
    });
  }

  const overall: HealthReport['overall'] = checks.some((c) => c.status === 'error')
    ? 'error'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'ok';

  return {
    provider: {
      id: config.id,
      label: config.label,
      kind: config.kind,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyMasked: resolved.present && resolved.secret ? resolved.secret.masked() : maskSecret(undefined),
      apiKeyEnv,
    },
    overall,
    checks,
    models: conn.models,
    latencyMs: conn.latencyMs,
  };
}
