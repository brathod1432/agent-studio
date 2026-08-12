// Test helpers for mocking HTTP so tests never hit a live API.

import type { FetchLike } from '../engine/providers/types.ts';

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function textResponse(status: number, text: string, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers });
}

/** A fetch that records calls and returns a fixed response (or one per call). */
export function recordingFetch(
  responder: Response | ((url: string, init?: RequestInit) => Response),
): { fetch: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return typeof responder === 'function' ? responder(url, init) : responder;
  };
  return { fetch, calls };
}

/** Build a chat-completion JSON response body. */
export function chatCompletionResponse(content: string, model = 'test-model'): Response {
  return jsonResponse(200, {
    model,
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
  });
}

/**
 * Build a Server-Sent-Events streaming chat response from text deltas.
 * When `usage` is provided, a final usage-only chunk is appended (as OpenAI-
 * compatible endpoints do when `stream_options.include_usage` is set).
 */
export function sseChatResponse(
  deltas: string[],
  model = 'test-model',
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): Response {
  const events = deltas.map((d) =>
    `data: ${JSON.stringify({ model, choices: [{ delta: { content: d } }] })}`,
  );
  events.push(`data: ${JSON.stringify({ model, choices: [{ delta: {}, finish_reason: 'stop' }] })}`);
  if (usage) events.push(`data: ${JSON.stringify({ model, choices: [], usage })}`);
  events.push('data: [DONE]');
  return new Response(events.join('\n\n') + '\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** A fetch that never resolves until aborted, then rejects like a timeout. */
export function abortingFetch(): FetchLike {
  return (_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        if (signal.aborted) return rejectAbort(reject);
        signal.addEventListener('abort', () => rejectAbort(reject), { once: true });
      }
    });
}

/** A fetch that throws immediately if invoked (to assert it is NOT called). */
export function failingFetch(message = 'fetch should not have been called'): FetchLike {
  return async () => {
    throw new Error(message);
  };
}

function rejectAbort(reject: (reason?: unknown) => void): void {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  reject(err);
}
