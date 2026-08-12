// Prompt registry. Loads named templates from a directory of `.md` files so
// prompts live outside code. Defaults ship in ./defaults; users can override the
// directory via AGENT_STUDIO_PROMPTS_DIR, or register templates programmatically.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SimpleTemplate, type PromptTemplate } from './template.ts';

/** Name of the default ChatAgent system prompt template. */
export const CHAT_SYSTEM = 'chat-system';

export class PromptRegistry {
  #dir: string;
  #cache = new Map<string, PromptTemplate>();

  constructor(dir?: string) {
    this.#dir = dir ?? process.env.AGENT_STUDIO_PROMPTS_DIR ?? join(import.meta.dirname, 'defaults');
  }

  /** Register/override a template programmatically. */
  register(template: PromptTemplate): void {
    this.#cache.set(template.name, template);
  }

  has(name: string): boolean {
    if (this.#cache.has(name)) return true;
    return existsSync(join(this.#dir, `${name}.md`));
  }

  get(name: string): PromptTemplate {
    const cached = this.#cache.get(name);
    if (cached) return cached;
    const path = join(this.#dir, `${name}.md`);
    if (!existsSync(path)) {
      throw new Error(`Prompt template not found: ${name} (looked in ${this.#dir})`);
    }
    const template = new SimpleTemplate(name, readFileSync(path, 'utf8').trim());
    this.#cache.set(name, template);
    return template;
  }

  list(): string[] {
    const names = new Set<string>(this.#cache.keys());
    if (existsSync(this.#dir)) {
      for (const f of readdirSync(this.#dir)) {
        if (f.endsWith('.md')) names.add(f.slice(0, -'.md'.length));
      }
    }
    return [...names].sort();
  }
}

let shared: PromptRegistry | undefined;

/** Shared default registry (lazy). */
export function defaultRegistry(): PromptRegistry {
  shared ??= new PromptRegistry();
  return shared;
}
