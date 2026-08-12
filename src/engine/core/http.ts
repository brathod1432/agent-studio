// Shared HTTP helpers used by provider/LLM adapters. Kept dependency-free.

import type { FetchLike } from '../providers/types.ts';

export function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, '');
  const p = path.replace(/^\/+/, '');
  return `${b}/${p}`;
}

/**
 * Fetch with an abort-based timeout. The timer is cleared once the response
 * headers arrive, so streaming bodies are not cut off by the timeout. An
 * optional external signal (e.g. a user pressing Ctrl+C) also aborts the
 * request; callers can inspect that signal to tell a cancel from a timeout.
 */
export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
