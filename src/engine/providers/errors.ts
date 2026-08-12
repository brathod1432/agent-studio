// Normalized provider error taxonomy. Adapters translate transport/vendor
// errors into these categories so the engine, diagnostics, and UI can respond
// consistently. Error messages are always safe to display (no secrets).

export type ProviderErrorKind =
  | 'missing_api_key'
  | 'invalid_api_key' // auth failure (401/403)
  | 'not_found' // endpoint/model not found (404)
  | 'rate_limit' // 429
  | 'timeout' // request exceeded timeout / aborted
  | 'network' // DNS/connection failure
  | 'server' // 5xx
  | 'invalid_config' // bad base URL / missing model, etc.
  | 'unknown';

export interface ProviderErrorFields {
  kind: ProviderErrorKind;
  message: string;
  /** HTTP status if applicable. */
  status?: number;
  /** Seconds to wait, parsed from Retry-After (rate limiting). */
  retryAfterSeconds?: number;
  /** Whether retrying the same request could plausibly succeed. */
  retryable: boolean;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly retryable: boolean;

  constructor(fields: ProviderErrorFields) {
    super(fields.message);
    this.name = 'ProviderError';
    this.kind = fields.kind;
    this.status = fields.status;
    this.retryAfterSeconds = fields.retryAfterSeconds;
    this.retryable = fields.retryable;
  }

  toJSON(): ProviderErrorFields {
    return {
      kind: this.kind,
      message: this.message,
      status: this.status,
      retryAfterSeconds: this.retryAfterSeconds,
      retryable: this.retryable,
    };
  }
}

export function missingApiKey(envName: string | undefined): ProviderError {
  const where = envName ? `Set ${envName} in your .env.local file.` : 'Configure an API key.';
  return new ProviderError({
    kind: 'missing_api_key',
    message: `No API key configured for this provider. ${where}`,
    retryable: false,
  });
}

/** Map an HTTP status (+ headers) to a normalized ProviderError. */
export function errorFromStatus(status: number, headers?: Headers, bodyHint?: string): ProviderError {
  const hint = bodyHint ? ` (${truncate(bodyHint, 200)})` : '';
  if (status === 401 || status === 403) {
    return new ProviderError({
      kind: 'invalid_api_key',
      status,
      message: `Authentication failed (HTTP ${status}). The API key was rejected.${hint}`,
      retryable: false,
    });
  }
  if (status === 404) {
    return new ProviderError({
      kind: 'not_found',
      status,
      message: `Endpoint or model not found (HTTP 404). Check the base URL and model id.${hint}`,
      retryable: false,
    });
  }
  if (status === 429) {
    const retryAfter = parseRetryAfter(headers);
    return new ProviderError({
      kind: 'rate_limit',
      status,
      retryAfterSeconds: retryAfter,
      message: `Rate limited (HTTP 429).${retryAfter != null ? ` Retry after ~${retryAfter}s.` : ''}`,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new ProviderError({
      kind: 'server',
      status,
      message: `Provider server error (HTTP ${status}). This is usually temporary.${hint}`,
      retryable: true,
    });
  }
  return new ProviderError({
    kind: 'unknown',
    status,
    message: `Unexpected response (HTTP ${status}).${hint}`,
    retryable: false,
  });
}

/** Map a thrown transport error (fetch/abort) to a normalized ProviderError. */
export function errorFromThrown(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = err as { name?: string; code?: string; message?: string };
  const name = e?.name ?? '';
  const code = e?.code ?? '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new ProviderError({
      kind: 'timeout',
      message: 'The request timed out. The endpoint may be slow or unreachable.',
      retryable: true,
    });
  }
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
    return new ProviderError({
      kind: 'network',
      message: `Could not reach the endpoint (${code}). Check the base URL and your network.`,
      retryable: true,
    });
  }
  return new ProviderError({
    kind: 'network',
    message: `Network error while contacting the provider: ${truncate(e?.message ?? 'unknown', 200)}`,
    retryable: true,
  });
}

function parseRetryAfter(headers?: Headers): number | undefined {
  const raw = headers?.get('retry-after');
  if (!raw) return undefined;
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) return Math.max(0, Math.round(asNum));
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  return undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
