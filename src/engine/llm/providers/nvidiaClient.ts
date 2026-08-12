// NVIDIA runtime client. NVIDIA's hosted/self-hosted NIM endpoints speak the
// OpenAI-compatible schema, so the NVIDIA client is the OpenAI-compatible client
// driven entirely by the NVIDIA provider configuration (endpoint, model, key
// ref) — nothing NVIDIA-specific is hardcoded here. Any future NVIDIA-only
// behavior (e.g. guardrails) belongs in this file, keeping vendor specifics out
// of the generic client and the rest of the engine.

import { OpenAICompatibleChatClient } from './openAICompatibleClient.ts';

export class NvidiaClient extends OpenAICompatibleChatClient {}
