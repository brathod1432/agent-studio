import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CHAT_SYSTEM, defaultRegistry, PromptRegistry } from './registry.ts';
import { SimpleTemplate } from './template.ts';

test('SimpleTemplate substitutes {{variables}} and leaves unknowns empty', () => {
  const tpl = new SimpleTemplate('t', 'Hello {{name}}, model={{model}} {{missing}}');
  assert.equal(tpl.render({ name: 'World', model: 'x' }), 'Hello World, model=x ');
});

test('default registry loads the chat-system prompt and renders the model', () => {
  const registry = defaultRegistry();
  assert.ok(registry.has(CHAT_SYSTEM));
  const rendered = registry.get(CHAT_SYSTEM).render({ model: 'nvidia/nemotron' });
  assert.ok(rendered.includes('nvidia/nemotron'), 'model placeholder is filled');
  assert.ok(rendered.length > 0);
  assert.ok(registry.list().includes(CHAT_SYSTEM));
});

test('templates can be overridden programmatically', () => {
  const registry = new PromptRegistry();
  registry.register(new SimpleTemplate(CHAT_SYSTEM, 'custom {{model}}'));
  assert.equal(registry.get(CHAT_SYSTEM).render({ model: 'm' }), 'custom m');
});
