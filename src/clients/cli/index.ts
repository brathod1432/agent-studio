// Agent Studio CLI. Commands:
//   onboard  - interactive first-run wizard (steps 1-5)
//   doctor   - run a provider health check on the active configuration
//   status   - show current configuration (secret-safe)
//
// Run: node --env-file-if-exists=.env.local src/clients/cli/index.ts <command>

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkEnvFile,
  formatHealthReport,
  healthCheck,
  isFirstRun,
  loadCatalog,
  loadSettings,
  resolveActiveProvider,
  resolvePaths,
  saveSettings,
  upsertEnvVar,
  type ProviderChoice,
} from '../../engine/index.ts';
import { OnboardingSession } from '../../engine/index.ts';
import { createPrompter } from './prompt.ts';
import { runChat } from './chat.ts';
import { runConfig } from './config.ts';
import { runAsk } from './ask.ts';
import { runExport, runHistory, runPrivacy, runPurge, runShow } from './data.ts';

function printBanner(): void {
  console.log('==============================================');
  console.log('        Welcome to Agent Studio');
  console.log('==============================================');
}

function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function runVersion(): void {
  console.log(`agent-studio ${readVersion()}`);
}

async function runOnboarding(): Promise<void> {
  printBanner();
  if (!process.stdin.isTTY) {
    console.log('\nOnboarding needs an interactive terminal.');
    console.log('Alternatively, set your provider in config/ and your key in .env.local, then run "doctor".');
    return;
  }

  const catalog = loadCatalog();
  const session = new OnboardingSession({ catalog });
  const prompt = createPrompter();

  try {
    // Step 1: choose provider.
    const choices: ProviderChoice[] = session.providerChoices();
    console.log('\nStep 1: Choose a provider\n');
    choices.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.label}${c.notes ? `  — ${c.notes}` : ''}`);
    });
    let providerId = '';
    while (!providerId) {
      const ans = await prompt.ask('\nSelect a provider (number or id)', '1');
      const byIndex = choices[Number(ans) - 1];
      const byId = choices.find((c) => c.id === ans);
      providerId = byIndex?.id ?? byId?.id ?? '';
      if (!providerId) console.log('  Please enter a valid number or provider id.');
    }
    let res = session.chooseProvider(providerId);
    if (!res.ok) throw new Error(res.error);

    // Step 2: credentials (+ endpoint for compatible/custom).
    console.log('\nStep 2: Enter credentials\n');
    let cred = res.view as unknown as { needsBaseUrl: boolean; apiKeyEnv: string; requiresApiKey: boolean; keyAlreadyInEnv: boolean };
    if (cred.needsBaseUrl) {
      const url = await prompt.ask('  Base URL (e.g. https://host/v1)');
      const label = await prompt.ask('  Display name', providerId);
      session.setEndpoint(url, label);
      cred = (session.view().view as unknown as typeof cred);
    }

    let saveKeyToEnv = false;
    if (cred.requiresApiKey || (await prompt.confirm('  Provide an API key for this provider?', false))) {
      if (cred.keyAlreadyInEnv && (await prompt.confirm(`  Found ${cred.apiKeyEnv} in your environment. Use it?`, true))) {
        // Use the existing env key; nothing to store.
      } else {
        let envName = cred.apiKeyEnv;
        if (!envName) envName = await prompt.ask('  Environment variable name for the key', 'CUSTOM_API_KEY');
        const key = await prompt.askHidden(`  Paste API key (input hidden)`);
        session.provideApiKey(key, envName);
        saveKeyToEnv = await prompt.confirm('  Save this key to .env.local (git-ignored)?', true);
      }
    }
    res = session.confirmCredentials();
    if (!res.ok) throw new Error(res.error);

    // Step 3: select model.
    console.log('\nStep 3: Select a model\n');
    const suggested = (res.view as { suggestedModel?: string }).suggestedModel ?? '';
    const model = await prompt.ask('  Model id', suggested || undefined);
    res = session.selectModel(model);
    if (!res.ok) throw new Error(res.error);

    // Step 4: test connection.
    console.log('\nStep 4: Test connection\n');
    console.log('  Testing…');
    const test = await session.runTest();
    console.log('');
    console.log(indent(formatHealthReport(session.lastReport!), '  '));
    if (!test.ok) {
      const proceed = await prompt.confirm('\n  The test did not fully pass. Save configuration anyway?', false);
      if (!proceed) {
        console.log('\nOnboarding cancelled. Nothing was saved.');
        return;
      }
    }

    // Step 5: persist and start.
    session.complete();
    if (session.hasTransientKey() && saveKeyToEnv) {
      const paths = resolvePaths();
      const envPath = join(paths.projectRoot, '.env.local');
      upsertEnvVar(envPath, session.apiKeyEnvName, session.revealApiKeyForPersistence()!);
      console.log(`\n  Saved API key to .env.local (as ${session.apiKeyEnvName}). It is git-ignored.`);
    }
    const base = loadSettings();
    const next = session.buildSettings(base);
    const savedPath = saveSettings(next);

    console.log('\nStep 5: Start workspace\n');
    console.log(`  Configuration saved to: ${savedPath}`);
    console.log('  You are ready to open a workspace. Run "doctor" any time to re-check your provider.');
  } finally {
    prompt.close();
  }
}

async function runDoctor(): Promise<void> {
  const catalog = loadCatalog();
  const settings = loadSettings();
  const active = resolveActiveProvider(settings, catalog);
  if (!active) {
    console.log('No provider is configured. Run "onboard" first.');
    process.exitCode = 1;
    return;
  }
  console.log(`Running health check for "${active.label}"…\n`);
  const report = await healthCheck(active, { request: settings.request });
  console.log(formatHealthReport(report));
  for (const warning of checkEnvFile(resolvePaths().projectRoot)) {
    console.log(`\n⚠ Security: ${warning}`);
  }
  process.exitCode = report.overall === 'error' ? 1 : 0;
}

function runStatus(): void {
  const catalog = loadCatalog();
  const first = isFirstRun();
  const settings = loadSettings();
  const active = resolveActiveProvider(settings, catalog);
  console.log(`First run:        ${first ? 'yes (no settings saved)' : 'no'}`);
  console.log(`Active provider:  ${active ? `${active.label} (${active.id})` : '(none)'}`);
  if (active) {
    console.log(`Endpoint:         ${active.baseUrl || '(not set)'}`);
    console.log(`Model:            ${active.model || '(not set)'}`);
    console.log(`API key ref:      ${active.apiKeyRef ?? '(none)'}`);
  }
  if (first) console.log('\nTip: run "onboard" to configure a provider.');
}

function indent(text: string, pad: string): string {
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

async function main(): Promise<void> {
  const raw = process.argv[2];
  const cmd = raw === '--version' || raw === '-v' ? 'version' : (raw ?? (isFirstRun() ? 'onboard' : 'status'));
  switch (cmd) {
    case 'version':
      runVersion();
      break;
    case 'onboard':
      await runOnboarding();
      break;
    case 'doctor':
      await runDoctor();
      break;
    case 'status':
      runStatus();
      break;
    case 'chat': {
      const chatArgs = process.argv.slice(3);
      const ephemeral = chatArgs.includes('--no-save') || chatArgs.includes('--ephemeral');
      const allowAnyFile = chatArgs.includes('--allow-any-file');
      const redactSecrets = chatArgs.includes('--redact-secrets');
      const mtIdx = chatArgs.findIndex((a) => a === '--max-tokens');
      const mtInline = chatArgs.find((a) => a.startsWith('--max-tokens='));
      const mtRaw = mtInline ? mtInline.slice('--max-tokens='.length) : mtIdx >= 0 ? chatArgs[mtIdx + 1] : undefined;
      const maxTokens = mtRaw != null && Number.isFinite(Number(mtRaw)) ? Number(mtRaw) : undefined;
      const sysIdx = chatArgs.findIndex((a) => a === '--system');
      const sysInline = chatArgs.find((a) => a.startsWith('--system='));
      const system = sysInline ? sysInline.slice('--system='.length) : sysIdx >= 0 ? chatArgs[sysIdx + 1] : undefined;
      const agent = chatArgs.includes('--agent');
      const autoApprove = chatArgs.includes('--auto-approve');
      const msIdx = chatArgs.findIndex((a) => a === '--max-steps');
      const msInline = chatArgs.find((a) => a.startsWith('--max-steps='));
      const msRaw = msInline ? msInline.slice('--max-steps='.length) : msIdx >= 0 ? chatArgs[msIdx + 1] : undefined;
      const maxSteps = msRaw != null && Number.isInteger(Number(msRaw)) ? Number(msRaw) : undefined;
      await runChat({ ephemeral, allowAnyFile, redactSecrets, maxTokens, system, agent, autoApprove, maxSteps });
      break;
    }
    case 'config':
      await runConfig(process.argv.slice(3));
      break;
    case 'ask':
      await runAsk(process.argv.slice(3));
      break;
    case 'privacy':
      runPrivacy();
      break;
    case 'history':
      runHistory();
      break;
    case 'show':
      runShow(process.argv.slice(3));
      break;
    case 'export':
      runExport(process.argv.slice(3));
      break;
    case 'purge':
      await runPurge(process.argv.slice(3));
      break;
    default:
      console.log(
        'Usage: agent-studio <onboard|doctor|status|chat|config|ask|history|show|export|privacy|purge|version>',
      );
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
