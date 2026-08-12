// First-run onboarding state machine (steps 1-5). Pure, side-effect-free logic
// shared by the CLI and web clients:
//   1 choose_provider -> 2 enter_credentials -> 3 select_model
//   -> 4 test_connection -> 5 complete
//
// The API key is held transiently in memory (wrapped in Secret) and is NEVER
// written into settings. Persisting the key to .env.local is left to the client
// via revealApiKeyForPersistence().

import type { AppSettings, ProviderCatalog, ProviderConfig, ProviderPreset } from '../config/types.ts';
import { providerConfigFromPreset } from '../config/store.ts';
import { envRef, Secret } from '../core/secrets.ts';
import { healthCheck, type HealthCheckOptions, type HealthReport } from '../providers/testing.ts';

export type OnboardingStep =
  | 'choose_provider'
  | 'enter_credentials'
  | 'select_model'
  | 'test_connection'
  | 'complete';

export interface ProviderChoice {
  id: string;
  label: string;
  kind: string;
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv: string;
  requiresApiKey: boolean;
  notes?: string;
}

export interface CredentialsView {
  providerLabel: string;
  apiKeyEnv: string;
  requiresApiKey: boolean;
  keyAlreadyInEnv: boolean;
  needsBaseUrl: boolean;
  baseUrl: string;
}

export interface StepResult {
  ok: boolean;
  error?: string;
  step: OnboardingStep;
  view: Record<string, unknown>;
}

function deriveEnvName(id: string): string {
  return `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
}

export interface OnboardingOptions {
  catalog: ProviderCatalog;
  env?: NodeJS.ProcessEnv;
  /** Injected for testing provider calls. */
  health?: HealthCheckOptions;
}

export class OnboardingSession {
  #catalog: ProviderCatalog;
  #env: NodeJS.ProcessEnv;
  #healthOpts: HealthCheckOptions;

  #step: OnboardingStep = 'choose_provider';
  #draft: Partial<ProviderConfig> = {};
  #apiKeyEnv = '';
  #apiKey?: Secret;
  #lastReport?: HealthReport;

  constructor(opts: OnboardingOptions) {
    this.#catalog = opts.catalog;
    this.#env = opts.env ?? process.env;
    this.#healthOpts = opts.health ?? {};
  }

  get step(): OnboardingStep {
    return this.#step;
  }

  providerChoices(): ProviderChoice[] {
    return Object.values(this.#catalog.providers).map((p: ProviderPreset) => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      baseUrl: p.baseUrl,
      defaultModel: p.defaultModel,
      apiKeyEnv: p.apiKeyEnv,
      requiresApiKey: p.requiresApiKey,
      notes: p.notes,
    }));
  }

  view(): StepResult {
    return { ok: true, step: this.#step, view: this.#viewData() };
  }

  #viewData(): Record<string, unknown> {
    switch (this.#step) {
      case 'choose_provider':
        return { providers: this.providerChoices() };
      case 'enter_credentials':
        return this.#credentialsView() as unknown as Record<string, unknown>;
      case 'select_model':
        return {
          suggestedModel: this.#draft.model ?? '',
          discoveredModels: this.#lastReport?.models?.map((m) => m.id) ?? [],
        };
      case 'test_connection':
        return { report: this.#lastReport ?? null };
      case 'complete':
        return { config: this.#draft };
    }
  }

  #credentialsView(): CredentialsView {
    const keyInEnv = Boolean(this.#apiKeyEnv && this.#env[this.#apiKeyEnv]);
    return {
      providerLabel: this.#draft.label ?? this.#draft.id ?? '',
      apiKeyEnv: this.#apiKeyEnv,
      requiresApiKey: Boolean(this.#draft.apiKeyRef),
      keyAlreadyInEnv: keyInEnv,
      needsBaseUrl: !this.#draft.baseUrl,
      baseUrl: this.#draft.baseUrl ?? '',
    };
  }

  // Step 1
  chooseProvider(id: string): StepResult {
    const preset = this.#catalog.providers[id];
    if (!preset) {
      return { ok: false, error: `Unknown provider "${id}".`, step: this.#step, view: this.#viewData() };
    }
    const config = providerConfigFromPreset(preset);
    this.#draft = config;
    // Determine the env var name for the key (derive one for key-requiring providers without a preset name).
    this.#apiKeyEnv = preset.apiKeyEnv || (preset.requiresApiKey ? deriveEnvName(preset.id) : '');
    // If the preset needs a key but had no env name, set the ref now.
    if (preset.requiresApiKey && !config.apiKeyRef && this.#apiKeyEnv) {
      this.#draft.apiKeyRef = envRef(this.#apiKeyEnv);
    }
    this.#step = 'enter_credentials';
    return this.view();
  }

  // Step 2 (a) optional endpoint/label for custom/compatible providers
  setEndpoint(baseUrl: string, label?: string): StepResult {
    this.#draft.baseUrl = baseUrl.trim();
    if (label) this.#draft.label = label;
    return this.view();
  }

  // Step 2 (b): provide the API key value (held transiently, never persisted here).
  provideApiKey(value: string | undefined, apiKeyEnvName?: string): StepResult {
    if (apiKeyEnvName) {
      this.#apiKeyEnv = apiKeyEnvName;
      this.#draft.apiKeyRef = envRef(apiKeyEnvName);
    }
    if (value && value.length > 0) {
      this.#apiKey = new Secret(value);
      if (this.#apiKeyEnv && !this.#draft.apiKeyRef) this.#draft.apiKeyRef = envRef(this.#apiKeyEnv);
    }
    return this.view();
  }

  /** Advance from credentials to model selection, validating requirements. */
  confirmCredentials(): StepResult {
    if (!this.#draft.baseUrl) {
      return { ok: false, error: 'A base URL is required for this provider.', step: this.#step, view: this.#viewData() };
    }
    const requiresKey = Boolean(this.#draft.apiKeyRef);
    const haveKey = Boolean(this.#apiKey) || Boolean(this.#apiKeyEnv && this.#env[this.#apiKeyEnv]);
    if (requiresKey && !haveKey) {
      return {
        ok: false,
        error: `An API key is required. Provide it now or set ${this.#apiKeyEnv} in .env.local.`,
        step: this.#step,
        view: this.#viewData(),
      };
    }
    this.#step = 'select_model';
    return this.view();
  }

  // Step 3
  selectModel(model: string): StepResult {
    const m = model.trim();
    if (!m) {
      return { ok: false, error: 'A model id is required.', step: this.#step, view: this.#viewData() };
    }
    this.#draft.model = m;
    this.#step = 'test_connection';
    return this.view();
  }

  // Step 4: run the connection + health test using the transient key merged into env.
  async runTest(): Promise<StepResult> {
    const config = this.#requireConfig();
    const env: NodeJS.ProcessEnv = { ...this.#env };
    if (this.#apiKey && this.#apiKeyEnv) env[this.#apiKeyEnv] = this.#apiKey.reveal();
    const report = await healthCheck(config, { ...this.#healthOpts, env });
    this.#lastReport = report;
    return { ok: report.overall !== 'error', error: report.overall === 'error' ? 'Connection test failed.' : undefined, step: this.#step, view: { report } };
  }

  get lastReport(): HealthReport | undefined {
    return this.#lastReport;
  }

  // Step 5: finalize. Returns the config to persist (no secrets).
  complete(): { config: ProviderConfig; step: OnboardingStep } {
    const config = this.#requireConfig();
    this.#step = 'complete';
    return { config, step: this.#step };
  }

  /** Merge the onboarded provider into an AppSettings object. */
  buildSettings(base: AppSettings): AppSettings {
    const config = this.#requireConfig();
    return {
      ...base,
      activeProvider: config.id,
      defaultModel: config.model,
      providers: { ...base.providers, [config.id]: config },
    };
  }

  /** Whether the user typed a key that should be written to .env.local. */
  hasTransientKey(): boolean {
    return Boolean(this.#apiKey);
  }

  get apiKeyEnvName(): string {
    return this.#apiKeyEnv;
  }

  /**
   * Explicitly reveal the transient key so a client can persist it to
   * .env.local (git-ignored). Never call this for logging/display.
   */
  revealApiKeyForPersistence(): string | undefined {
    return this.#apiKey?.reveal();
  }

  #requireConfig(): ProviderConfig {
    const d = this.#draft;
    if (!d.id || !d.label || !d.kind || d.baseUrl == null || !d.model) {
      throw new Error('Onboarding is incomplete; missing provider fields.');
    }
    return {
      id: d.id,
      label: d.label,
      kind: d.kind,
      baseUrl: d.baseUrl,
      apiKeyRef: d.apiKeyRef,
      model: d.model,
    };
  }
}
