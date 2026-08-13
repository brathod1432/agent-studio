import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChatResponse, RawMessage, ToolSchema } from '../llm/types.ts';
import { runToolLoop, toolSchema } from './toolLoop.ts';

function reply(content: string, toolCalls: { name: string; args: unknown; id?: string }[] = []): ChatResponse {
  return {
    content,
    toolCalls: toolCalls.map((t, i) => ({ id: t.id ?? `c${i}`, name: t.name, arguments: JSON.stringify(t.args) })),
  };
}

test('toolSchema: descriptor -> OpenAI function schema', () => {
  const s = toolSchema({ name: 'text.stats', description: 'd', inputSchema: { type: 'object', properties: {} } });
  assert.equal(s.type, 'function');
  assert.equal(s.function.name, 'text.stats');
  assert.deepEqual(s.function.parameters, { type: 'object', properties: {} });
});

test('runToolLoop: returns final immediately when no tool calls', async () => {
  const res = await runToolLoop(async () => reply('hello'), [{ role: 'user', content: 'hi' }], [], async () => null);
  assert.equal(res.content, 'hello');
  assert.equal(res.stoppedReason, 'final');
  assert.equal(res.toolCallsMade, 0);
});

test('runToolLoop: executes a tool then returns the final answer', async () => {
  const responses = [reply('', [{ name: 'text.stats', args: { text: 'a b c' } }]), reply('3 words')];
  const executed: [string, Record<string, unknown>][] = [];
  const res = await runToolLoop(
    async (msgs: RawMessage[]) => {
      if (responses.length === 1) assert.ok(msgs.some((m) => m.role === 'tool'));
      return responses.shift()!;
    },
    [{ role: 'user', content: 'count' }],
    [],
    async (name, args) => {
      executed.push([name, args]);
      return { words: 3 };
    },
  );
  assert.equal(res.content, '3 words');
  assert.equal(res.toolCallsMade, 1);
  assert.deepEqual(executed, [['text.stats', { text: 'a b c' }]]);
});

test('runToolLoop: a denied call feeds an error, never executes', async () => {
  const responses = [reply('', [{ name: 'fs.summarize', args: { path: '/etc' } }]), reply('skipped')];
  let executed = false;
  const res = await runToolLoop(
    async () => responses.shift()!,
    [{ role: 'user', content: 'scan' }],
    [],
    async () => {
      executed = true;
      return {};
    },
    { approve: async () => false },
  );
  assert.equal(executed, false);
  assert.equal(res.content, 'skipped');
  assert.equal(res.toolCallsMade, 0);
});

test('runToolLoop: a thrown tool error is surfaced to the model, not raised', async () => {
  const responses = [reply('', [{ name: 'boom', args: {} }]), reply('recovered')];
  const res = await runToolLoop(
    async () => responses.shift()!,
    [{ role: 'user', content: 'x' }],
    [],
    async () => {
      throw new Error('kaboom');
    },
  );
  assert.equal(res.content, 'recovered');
  const toolMsgs = res.messages.filter((m) => m.role === 'tool');
  assert.match(String(toolMsgs.at(-1)!.content), /kaboom/);
});

test('runToolLoop: max-steps budget stops an endless tool-caller', async () => {
  const offered: ToolSchema[] = [{ type: 'function', function: { name: 'noop' } }];
  const res = await runToolLoop(
    async (_msgs, tools) => (tools.length === 0 ? reply('giving up') : reply('', [{ name: 'noop', args: {} }])),
    [{ role: 'user', content: 'x' }],
    offered,
    async () => ({ ok: true }),
    { maxSteps: 3 },
  );
  assert.equal(res.stoppedReason, 'max_steps');
  assert.equal(res.steps, 3);
  assert.equal(res.content, 'giving up');
});
