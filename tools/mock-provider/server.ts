// Local mock of an OpenAI-compatible LLM endpoint (as used by NVIDIA NIM,
// OpenAI, Ollama, etc.). Zero dependencies, loopback-only. Lets you run the real
// CLI (onboard/doctor/chat) end-to-end without any external network.
//
// Run: node tools/mock-provider/server.ts   (port via MOCK_PORT, default 4321)
//
// Endpoints (base path /v1):
//   GET  /v1/models             -> model list (requires bearer auth)
//   POST /v1/chat/completions   -> JSON or SSE stream (requires bearer auth)
//
// Auth: any non-empty Bearer token is accepted EXCEPT the literal "INVALID",
//       which returns 401 (to exercise the invalid-key path).
// Unknown models return 404 (to exercise the not_found path).
//
// SECURITY: never logs the Authorization header or token value.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4321);
const HOST = '127.0.0.1';

const KNOWN_MODELS = ['nvidia/nemotron-3.5-lightning-30b-a3b', 'meta/llama-3.1-8b-instruct'];

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function authToken(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return undefined;
  const t = h.slice('Bearer '.length).trim();
  return t.length ? t : undefined;
}

function unauthorized(res: ServerResponse): void {
  send(res, 401, { error: { message: 'Invalid or missing API key.', type: 'authentication_error' } });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function lastUserMessage(messages: Array<{ role?: string; content?: string }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messages[i]?.content ?? '';
  }
  return '';
}

function streamCompletion(res: ServerResponse, model: string, text: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  const words = text.split(' ');
  let i = 0;
  const tick = (): void => {
    if (i < words.length) {
      const delta = (i === 0 ? '' : ' ') + words[i];
      res.write(`data: ${JSON.stringify({ model, choices: [{ index: 0, delta: { content: delta } }] })}\n\n`);
      i++;
      setTimeout(tick, 15);
    } else {
      res.write(`data: ${JSON.stringify({ model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  };
  tick();
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  // Log method + path only — NEVER the Authorization header.
  process.stdout.write(`[mock] ${req.method} ${url.pathname}\n`);

  const token = authToken(req);

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    if (!token || token === 'INVALID') return unauthorized(res);
    return send(res, 200, {
      object: 'list',
      data: KNOWN_MODELS.map((id) => ({ id, object: 'model', owned_by: 'mock' })),
    });
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    if (!token || token === 'INVALID') return unauthorized(res);
    void readJson(req).then((body) => {
      const model = String(body.model ?? '');
      if (!KNOWN_MODELS.includes(model)) {
        return send(res, 404, { error: { message: `Model not found: ${model}`, type: 'not_found_error' } });
      }
      const messages = (body.messages as Array<{ role?: string; content?: string }>) ?? [];
      const reply = `You said: "${lastUserMessage(messages)}". This is a mock ${model} reply.`;
      if (body.stream === true) return streamCompletion(res, model, reply);
      return send(res, 200, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
      });
    });
    return;
  }

  send(res, 404, { error: { message: 'Not found', type: 'invalid_request_error' } });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[mock] OpenAI-compatible mock listening on http://${HOST}:${PORT}/v1\n`);
});
