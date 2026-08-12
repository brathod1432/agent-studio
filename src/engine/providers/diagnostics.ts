// Formats health reports and provider errors into user-friendly, secret-safe
// diagnostics for the CLI and web clients.

import { scrubString } from '../core/redact.ts';
import type { ProviderError, ProviderErrorKind } from './errors.ts';
import type { CheckStatus } from './types.ts';
import type { HealthReport } from './testing.ts';

const STATUS_ICON: Record<CheckStatus, string> = { ok: '✓', warn: '!', error: '✗' };

/** Actionable remediation hints keyed by error kind. */
export function remediationFor(kind: ProviderErrorKind, envName?: string): string {
  switch (kind) {
    case 'missing_api_key':
      return envName
        ? `Add ${envName}=<your-key> to .env.local (it is git-ignored), then re-run the test.`
        : 'Provide an API key for this provider, then re-run the test.';
    case 'invalid_api_key':
      return 'Double-check the API key value and that it has access to this endpoint.';
    case 'not_found':
      return 'Verify the base URL path (it usually ends in /v1) and that the model id is correct.';
    case 'rate_limit':
      return 'You are being rate limited. Wait a moment and try again, or reduce request frequency.';
    case 'timeout':
      return 'The endpoint took too long. Check connectivity, increase the timeout, or try again.';
    case 'network':
      return 'Check the base URL, your internet/VPN connection, and any firewall/proxy settings.';
    case 'server':
      return 'The provider had a server-side error. This is usually temporary — retry shortly.';
    case 'invalid_config':
      return 'Review the provider configuration (base URL, kind, model).';
    default:
      return 'Review the configuration and try again.';
  }
}

/** Render a health report as plain text lines (already secret-safe). */
export function formatHealthReport(report: HealthReport): string {
  const lines: string[] = [];
  const p = report.provider;
  lines.push(`Provider:  ${p.label} (${p.id}) [${p.kind}]`);
  lines.push(`Endpoint:  ${p.baseUrl || '(not set)'}`);
  lines.push(`Model:     ${p.model || '(not set)'}`);
  lines.push(`API key:   ${p.apiKeyMasked}${p.apiKeyEnv ? ` (from ${p.apiKeyEnv})` : ''}`);
  lines.push(`Overall:   ${report.overall.toUpperCase()}`);
  lines.push('');
  lines.push('Checks:');
  for (const c of report.checks) {
    lines.push(`  ${STATUS_ICON[c.status]} ${c.name}: ${c.message}`);
  }
  if (report.latencyMs != null) {
    lines.push('');
    lines.push(`Latency:   ${report.latencyMs}ms`);
  }
  return scrubString(lines.join('\n'));
}

/** One-line summary of a provider error plus remediation. */
export function formatError(err: ProviderError, envName?: string): string {
  return scrubString(`${err.message}\nWhat to do: ${remediationFor(err.kind, envName)}`);
}
