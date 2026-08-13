import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createPythonBridge } from './pythonBridge.ts';

const PYTHON = process.env.AGENT_STUDIO_PYTHON ?? 'python';

function pythonAvailable(): boolean {
  try {
    const res = spawnSync(PYTHON, ['--version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

test('pythonBridge: ping, list tools, and call a tool over stdio', async (t) => {
  if (!pythonAvailable()) {
    t.skip(`Python ("${PYTHON}") not available; skipping cross-language integration test.`);
    return;
  }
  const bridge = createPythonBridge({ timeoutMs: 20000 });
  try {
    const pong = await bridge.ping();
    assert.equal(pong.ok, true);
    assert.match(pong.version, /\d+\.\d+\.\d+/);

    const tools = await bridge.listTools();
    const names = tools.map((tItem) => tItem.name);
    assert.ok(names.includes('text.stats'));
    assert.ok(names.includes('code.analyze'));

    const stats = (await bridge.callTool('text.stats', { text: 'the cat sat on the cat mat' })) as {
      words: number;
      top_words: [string, number][];
    };
    assert.equal(stats.words, 7);
    assert.equal(stats.top_words[0]![0], 'cat');

    const analysis = (await bridge.callTool('code.analyze', {
      source: 'def f(a, b):\n    return a\n',
    })) as { counts: { functions: number } };
    assert.equal(analysis.counts.functions, 1);
  } finally {
    bridge.close();
  }
});

test('pythonBridge: a tool error is surfaced as a rejected promise', async (t) => {
  if (!pythonAvailable()) {
    t.skip('Python not available; skipping.');
    return;
  }
  const bridge = createPythonBridge({ timeoutMs: 20000 });
  try {
    await assert.rejects(() => bridge.callTool('does.not.exist', {}), /Unknown tool/);
  } finally {
    bridge.close();
  }
});

test('pythonBridge: lists agents and runs a pipeline agent over the bridge', async (t) => {
  if (!pythonAvailable()) {
    t.skip('Python not available; skipping.');
    return;
  }
  const bridge = createPythonBridge({ timeoutMs: 30000 });
  const dir = mkdtempSync(join(tmpdir(), 'as-agent-'));
  try {
    const agents = await bridge.listAgents();
    const ids = agents.map((a) => a.id);
    assert.ok(ids.includes('code-reviewer'));
    assert.ok(ids.includes('security-auditor'));

    writeFileSync(join(dir, 'm.py'), 'def a():\n    return 1\n', 'utf8');
    const result = await bridge.runAgent('code-reviewer', dir);
    assert.equal(result.workflow, 'pipeline');
    assert.match(result.content, /Code Review/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    bridge.close();
  }
});
