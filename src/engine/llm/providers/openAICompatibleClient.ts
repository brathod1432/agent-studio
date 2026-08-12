// OpenAI-compatible chat client. Implements chat + streaming against the
// standard /chat/completions endpoint. Covers NVIDIA NIM, OpenAI, Ollama,
// LM Studio, OpenRouter, and custom endpoints — all driven purely by the
// provider configuration (no hardcoded URLs or model names).

import type { ProviderConfig, RequestSettings } from '../../config/types.ts';
import { fetchWithTimeout, joinUrl } from '../../core/http.ts';
import { createProvider } from '../../providers/factory.ts';
import { errorFromStatus, errorFromThrown, missingApiKey } from '../../providers/errors.ts';
import type { FetchLike } from '../../providers/types.ts';
import type {
  ChatRequest,
  ChatResponse,
  LLMClient,
  LLMClientOptions,
  StreamDeltaHandler,
} from '../types.ts';

interface ChatCompletionChoice {
  message?: { content?: string };
  delta?: { content?: string };
  finish_reason?: string;
}
interface ChatCompletionBody {
  model?: string;
  choices?: ChatCompletionChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export class OpenAICompatibleChatClient implements LLMClient {
  readonly config: ProviderConfig;
  readonly #apiKey?: string;
  readonly #request: RequestSettings;
  readonly #fetchImpl?: FetchLike;

  constructor(opts: LLMClientOptions) {
    this.config = opts.config;
    this.#apiKey = opts.apiKey;
    this.#request = opts.request;
    this.#fetchImpl = opts.fetchImpl;
  }

  get providerId(): string {
    return this.config.id;
  }

  get model(): string {
    return this.config.model;
  }

  supportsStreaming(): boolean {
    return true;
  }

  #fetch(): FetchLike {
    const impl = this.#fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!impl) throw errorFromThrown(new Error('No fetch implementation available.'));
    return impl;
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
    if (this.#apiKey) h.Authorization = `Bearer ${this.#apiKey}`;
    return h;
  }

  #requireKey(): void {
    if (this.config.apiKeyRef && !this.#apiKey) {
      throw missingApiKey(this.config.apiKeyRef.replace(/^env:/, ''));
    }
  }

  #body(request: ChatRequest, stream: boolean): string {
    const body: Record<string, unknown> = {
      model: request.model ?? this.config.model,
      messages: request.messages,
      stream,
    };
    // Ask OpenAI-compatible endpoints to include a final usage chunk while
    // streaming. Endpoints that don't support this simply ignore the field.
    if (stream) body.stream_options = { include_usage: true };
    if (request.temperature != null) body.temperature = request.temperature;
    return JSON.stringify(body);
  }

  async validate(): Promise<boolean> {
    // Reuse the provider-layer connection test (no duplicated config logic).
    const result = await createProvider(this.config).testConnection({
      apiKey: this.#apiKey,
      request: this.#request,
      fetchImpl: this.#fetchImpl,
    });
    return result.ok;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.#requireKey();
    const url = joinUrl(this.config.baseUrl, 'chat/completions');
    let res: Response;
    try {
      res = await fetchWithTimeout(
        this.#fetch(),
        url,
        { method: 'POST', headers: this.#headers({ Accept: 'application/json' }), body: this.#body(request, false) },
        this.#request.timeoutMs,
        request.signal,
      );
    } catch (err) {
      // A user-initiated cancel yields an empty (but non-error) response.
      if (request.signal?.aborted) return { content: '', finishReason: 'cancelled' };
      throw errorFromThrown(err);
    }
    if (!res.ok) throw errorFromStatus(res.status, res.headers, await safeText(res));

    const data = (await res.json().catch(() => ({}))) as ChatCompletionBody;
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      model: data.model,
      finishReason: choice?.finish_reason,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  async chatStream(request: ChatRequest, onDelta: StreamDeltaHandler): Promise<ChatResponse> {
    this.#requireKey();
    const url = joinUrl(this.config.baseUrl, 'chat/completions');

    // Streaming needs one signal that (a) aborts on timeout until headers arrive
    // and (b) keeps honoring an external cancel for the whole body. fetchWithTimeout
    // clears its linkage after headers, so we manage the controller here instead.
    const external = request.signal;
    const controller = new AbortController();
    const onExternalAbort = (): void => controller.abort();
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), this.#request.timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    };

    let res: Response;
    try {
      res = await this.#fetch()(url, {
        method: 'POST',
        headers: this.#headers({ Accept: 'text/event-stream' }),
        body: this.#body(request, true),
        signal: controller.signal,
      });
    } catch (err) {
      cleanup();
      if (external?.aborted) return { content: '', finishReason: 'cancelled' };
      throw errorFromThrown(err);
    }
    // Headers received: stop the timeout but keep the external-cancel link so a
    // Ctrl+C mid-stream still aborts the in-flight body.
    clearTimeout(timer);
    if (!res.ok) {
      external?.removeEventListener('abort', onExternalAbort);
      throw errorFromStatus(res.status, res.headers, await safeText(res));
    }

    let full = '';
    let finishReason: string | undefined;
    let model: string | undefined;
    let usage: ChatResponse['usage'];

    const onEvent = (payload: string): boolean => {
      if (payload === '[DONE]') return true;
      let parsed: ChatCompletionBody;
      try {
        parsed = JSON.parse(payload) as ChatCompletionBody;
      } catch {
        return false;
      }
      if (parsed.model) model = parsed.model;
      // Final usage chunk (from stream_options.include_usage) has empty choices.
      if (parsed.usage) {
        usage = {
          promptTokens: parsed.usage.prompt_tokens,
          completionTokens: parsed.usage.completion_tokens,
          totalTokens: parsed.usage.total_tokens,
        };
      }
      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content ?? choice?.message?.content ?? '';
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (delta) {
        full += delta;
        onDelta(delta);
      }
      return false;
    };

    try {
      await consumeSse(res, onEvent);
    } catch (err) {
      // Cancelled mid-stream: keep whatever streamed so far.
      if (external?.aborted) return { content: full, model, finishReason: 'cancelled', usage };
      throw errorFromThrown(err);
    } finally {
      external?.removeEventListener('abort', onExternalAbort);
    }
    return { content: full, model, finishReason, usage };
  }
}

/** Parse an SSE response body, invoking `onEvent(payload)` per `data:` line. */
async function consumeSse(res: Response, onEvent: (payload: string) => boolean): Promise<void> {
  const process = (text: string, buf: string): { buf: string; done: boolean } => {
    buf += text;
    let idx: number;
    // SSE events are separated by a blank line.
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of block.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        if (onEvent(trimmed.slice(5).trim())) return { buf, done: true };
      }
    }
    return { buf, done: false };
  };

  if (res.body && typeof (res.body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const r = process(decoder.decode(value, { stream: true }), buf);
      buf = r.buf;
      if (r.done) {
        await reader.cancel().catch(() => undefined);
        return;
      }
    }
    // Flush any trailing event without the terminating blank line.
    process(buf + '\n\n', '');
    return;
  }

  // Fallback: no streaming body — parse the whole text at once.
  process((await res.text()) + '\n\n', '');
}

async function safeText(res: Response): Promise<string | undefined> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return undefined;
  }
}
