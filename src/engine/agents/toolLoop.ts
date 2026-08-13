// Agentic tool-calling loop (mirrors the Python tool_loop). The model is offered
// tools; when it requests one we (optionally ask the user to approve, then)
// execute it and feed the result back, looping until a final answer or a step
// budget is hit. Fully injectable (LLM call, executor, approval) for testing.

import type { ChatResponse, RawMessage, ToolSchema } from '../llm/types.ts';

export type ToolLoopLLM = (messages: RawMessage[], tools: ToolSchema[]) => Promise<ChatResponse>;
export type ToolExecute = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type ToolApprove = (name: string, args: Record<string, unknown>) => Promise<boolean>;
export type ToolEvent = (kind: 'call' | 'result' | 'denied' | 'error', detail: string) => void;

export interface ToolLoopResult {
  content: string;
  steps: number;
  toolCallsMade: number;
  stoppedReason: 'final' | 'max_steps';
  messages: RawMessage[];
}

export interface ToolLoopOptions {
  approve?: ToolApprove;
  onEvent?: ToolEvent;
  maxSteps?: number;
}

/**
 * Provider-safe function name. Names sent to providers must match
 * `^[a-zA-Z0-9_-]+$` (NVIDIA rejects dots), so map our dotted tool ids.
 */
export function safeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Map provider-safe names back to the real (dotted) tool names. */
export function aliasMap(names: string[]): Map<string, string> {
  return new Map(names.map((n) => [safeToolName(n), n]));
}

/** Convert a tool registry descriptor to an OpenAI function-tool schema. */
export function toolSchema(descriptor: {
  name: string;
  description?: string;
  inputSchema?: unknown;
}): ToolSchema {
  return {
    type: 'function',
    function: {
      name: safeToolName(descriptor.name),
      description: descriptor.description ?? '',
      parameters: descriptor.inputSchema ?? { type: 'object', properties: {} },
    },
  };
}

function toolMessage(callId: string, result: unknown): RawMessage {
  return { role: 'tool', tool_call_id: callId, content: JSON.stringify(result) };
}

export async function runToolLoop(
  llm: ToolLoopLLM,
  messages: RawMessage[],
  tools: ToolSchema[],
  execute: ToolExecute,
  options: ToolLoopOptions = {},
): Promise<ToolLoopResult> {
  const { approve, onEvent, maxSteps = 6 } = options;
  const convo: RawMessage[] = [...messages];
  let toolCallsMade = 0;
  const emit = (kind: Parameters<ToolEvent>[0], detail: string): void => onEvent?.(kind, detail);

  for (let step = 1; step <= maxSteps; step++) {
    const response = await llm(convo, tools);
    const calls = response.toolCalls ?? [];
    if (calls.length === 0) {
      return { content: response.content, steps: step, toolCallsMade, stoppedReason: 'final', messages: convo };
    }

    convo.push({
      role: 'assistant',
      content: response.content ?? '',
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    });

    for (const call of calls) {
      let args: Record<string, unknown>;
      try {
        const parsed = call.arguments.trim() ? JSON.parse(call.arguments) : {};
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('arguments must be a JSON object');
        }
        args = parsed as Record<string, unknown>;
      } catch (err) {
        emit('error', `${call.name}: bad arguments (${err instanceof Error ? err.message : String(err)})`);
        convo.push(toolMessage(call.id, { error: `invalid arguments: ${err instanceof Error ? err.message : String(err)}` }));
        continue;
      }

      emit('call', `${call.name} ${JSON.stringify(args)}`);
      if (approve && !(await approve(call.name, args))) {
        emit('denied', call.name);
        convo.push(toolMessage(call.id, { error: 'the user did not approve this tool call' }));
        continue;
      }

      try {
        const result = await execute(call.name, args);
        toolCallsMade += 1;
        emit('result', `${call.name} -> ok`);
        convo.push(toolMessage(call.id, result));
      } catch (err) {
        emit('error', `${call.name}: ${err instanceof Error ? err.message : String(err)}`);
        convo.push(toolMessage(call.id, { error: err instanceof Error ? err.message : String(err) }));
      }
    }
  }

  // Budget exhausted: ask once more for a plain answer (no tools).
  const final = await llm(convo, []);
  return { content: final.content, steps: maxSteps, toolCallsMade, stoppedReason: 'max_steps', messages: convo };
}
