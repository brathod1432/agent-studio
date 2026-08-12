// Engine public API barrel. Clients (CLI, web, future desktop UI) import from
// here so the internal module layout can evolve without breaking callers.

export * from './config/types.ts';
export { loadCatalog, loadDefaultConfig, listPresets } from './config/catalog.ts';
export {
  isFirstRun,
  loadSettings,
  saveSettings,
  resolveActiveProvider,
  providerConfigFromPreset,
  setActiveModel,
  setActiveProvider,
  type StoreOptions,
} from './config/store.ts';
export { resolvePaths, type ResolvedPaths } from './core/paths.ts';
export {
  Secret,
  maskSecret,
  resolveSecret,
  parseSecretRef,
  envRef,
  parseEnv,
  loadEnvFile,
  type ResolvedSecret,
} from './core/secrets.ts';
export { upsertEnvVar } from './core/envFile.ts';
export { stripBom, parseJson, readJsonFile, JsonParseError } from './core/jsonFile.ts';
export { logger, Logger, type LogLevel } from './core/logger.ts';
export { redact, registerSecretValue, scrubString } from './core/redact.ts';
export { detectSecrets, looksLikeSecret, describeSecretKinds } from './core/secretScan.ts';
export {
  expandFileReferences,
  extractFileRefs,
  type ExpandOptions,
  type ExpandResult,
  type FileRef,
  type FileReader,
  type FileReadResult,
} from './context/fileContext.ts';
export {
  ProviderError,
  type ProviderErrorKind,
  errorFromStatus,
  errorFromThrown,
  missingApiKey,
} from './providers/errors.ts';
export type {
  Provider,
  ProviderRuntimeContext,
  ConnectionTestResult,
  CheckResult,
  CheckStatus,
  ModelInfo,
  FetchLike,
} from './providers/types.ts';
export { createProvider } from './providers/factory.ts';
export {
  healthCheck,
  testConnection,
  validateModel,
  listProviderModels,
  type HealthReport,
  type HealthCheckOptions,
} from './providers/testing.ts';
export { formatHealthReport, formatError, remediationFor } from './providers/diagnostics.ts';
export {
  OnboardingSession,
  type OnboardingStep,
  type OnboardingOptions,
  type ProviderChoice,
  type StepResult,
} from './onboarding/onboarding.ts';

// ---------------------------------------------------------------------------
// Phase 2: Agent runtime (LLM clients, memory, prompts, agents)
// ---------------------------------------------------------------------------
export type {
  LLMClient,
  LLMClientOptions,
  ChatMessage,
  ChatRole,
  ChatRequest,
  ChatResponse,
  TokenUsage,
  StreamDeltaHandler,
} from './llm/types.ts';
export {
  createLLMClient,
  createLLMClientFromSettings,
  type FromSettingsOptions,
  type ResolvedLLM,
} from './llm/factory.ts';
export { OpenAICompatibleChatClient } from './llm/providers/openAICompatibleClient.ts';
export { NvidiaClient } from './llm/providers/nvidiaClient.ts';
export {
  estimateTokensFromText,
  estimateUsage,
  hasTokenCounts,
  addUsage,
  zeroUsage,
} from './llm/usage.ts';
export { trimMessages, type TrimResult } from './llm/contextWindow.ts';

export {
  CONVERSATION_SCHEMA_VERSION,
  type Conversation,
  type ConversationSummary,
  type ConversationSearchResult,
} from './memory/types.ts';
export { conversationToMarkdown, defaultExportFilename } from './memory/export.ts';
export {
  conversationsDir,
  conversationPath,
  readConversationFile,
  writeConversationFile,
  listConversationIds,
  deleteConversationFile,
  type PersistenceOptions,
} from './memory/persistence.ts';
export { ConversationStore, deriveTitle, type NewConversationInput } from './memory/store.ts';

export { type PromptTemplate, SimpleTemplate } from './prompts/template.ts';
export { PromptRegistry, defaultRegistry, CHAT_SYSTEM } from './prompts/registry.ts';

export { type Agent, type StreamingAgent, type AgentDeltaHandler } from './agents/agent.ts';
export { ChatAgent, type ChatAgentOptions, type TurnOptions } from './agents/chatAgent.ts';

// Python tool bridge (process-isolated stdio JSON-RPC extension).
export {
  PythonBridge,
  createPythonBridge,
  type PythonBridgeOptions,
  type ToolDescriptor,
} from './bridge/pythonBridge.ts';
