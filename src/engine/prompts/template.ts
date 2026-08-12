// Prompt templates. Templates are stored outside code (see ./defaults) and
// rendered with a simple {{variable}} substitution so prompts can be customized
// without touching implementation logic.

export interface PromptTemplate {
  readonly name: string;
  render(context?: Record<string, string>): string;
}

export class SimpleTemplate implements PromptTemplate {
  readonly name: string;
  readonly #template: string;

  constructor(name: string, template: string) {
    this.name = name;
    this.#template = template;
  }

  render(context: Record<string, string> = {}): string {
    return this.#template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
      const value = context[key];
      return value == null ? '' : value;
    });
  }

  get source(): string {
    return this.#template;
  }
}
