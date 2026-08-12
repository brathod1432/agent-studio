// Minimal local web onboarding server. Loopback-only, same shared engine as the
// CLI. Serves a single self-contained page and JSON endpoints that drive the
// OnboardingSession. Secrets are never logged; request bodies are not logged.
//
// Run: node --env-file-if-exists=.env.local src/clients/web/index.ts

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import {
  loadCatalog,
  loadSettings,
  logger,
  resolvePaths,
  saveSettings,
  upsertEnvVar,
  OnboardingSession,
} from '../../engine/index.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.AGENT_STUDIO_WEB_PORT ?? 4173);

const catalog = loadCatalog();
let session = new OnboardingSession({ catalog });

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function isLoopbackHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').split(':')[0];
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function servePage(res: ServerResponse): void {
  const html = readFileSync(join(import.meta.dirname, 'public', 'onboard.html'), 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  // NOTE: we log method + path only — never headers or body (may contain a key).
  logger.debug('web request', { method: req.method, path: url.pathname });

  if (!isLoopbackHost(req)) {
    json(res, 403, { error: 'Only loopback access is allowed.' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') return servePage(res);

  if (req.method === 'GET' && url.pathname === '/api/providers') {
    return json(res, 200, { providers: session.providerChoices() });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    switch (url.pathname) {
      case '/api/reset':
        session = new OnboardingSession({ catalog });
        return json(res, 200, session.view());
      case '/api/choose':
        return json(res, 200, session.chooseProvider(String(body.providerId ?? '')));
      case '/api/endpoint':
        return json(res, 200, session.setEndpoint(String(body.baseUrl ?? ''), body.label ? String(body.label) : undefined));
      case '/api/credentials':
        // The key is used transiently; it is never logged or echoed back.
        return json(
          res,
          200,
          session.provideApiKey(
            body.apiKey ? String(body.apiKey) : undefined,
            body.apiKeyEnvName ? String(body.apiKeyEnvName) : undefined,
          ),
        );
      case '/api/confirm':
        return json(res, 200, session.confirmCredentials());
      case '/api/model':
        return json(res, 200, session.selectModel(String(body.model ?? '')));
      case '/api/test':
        return json(res, 200, await session.runTest());
      case '/api/complete': {
        session.complete();
        let envSaved = false;
        if (session.hasTransientKey() && body.saveKeyToEnv) {
          const envPath = join(resolvePaths().projectRoot, '.env.local');
          upsertEnvVar(envPath, session.apiKeyEnvName, session.revealApiKeyForPersistence()!);
          envSaved = true;
        }
        const next = session.buildSettings(loadSettings());
        const savedPath = saveSettings(next);
        return json(res, 200, { ok: true, savedPath, envSaved, apiKeyEnv: session.apiKeyEnvName });
      }
      default:
        return json(res, 404, { error: 'Not found' });
    }
  }

  json(res, 404, { error: 'Not found' });
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    logger.error('web handler error', { message: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) json(res, 500, { error: 'Internal error' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Agent Studio onboarding: http://${HOST}:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});
