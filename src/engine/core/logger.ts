// Redacting logger. All log output is passed through redaction so registered
// secrets and sensitive keys can never be printed. This is the ONLY logger the
// engine and clients should use.

import { redact, scrubString } from './redact.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  level?: LogLevel;
  /** Sink for output; defaults to console. Injectable for tests. */
  sink?: (level: LogLevel, line: string) => void;
}

function defaultSink(level: LogLevel, line: string): void {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export class Logger {
  #level: LogLevel;
  #sink: (level: LogLevel, line: string) => void;

  constructor(options: LoggerOptions = {}) {
    this.#level = options.level ?? 'info';
    this.#sink = options.sink ?? defaultSink;
  }

  setLevel(level: LogLevel): void {
    this.#level = level;
  }

  #emit(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#level]) return;
    const safeMessage = scrubString(message);
    let line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${safeMessage}`;
    if (meta !== undefined) {
      line += ' ' + JSON.stringify(redact(meta));
    }
    this.#sink(level, line);
  }

  debug(message: string, meta?: unknown): void {
    this.#emit('debug', message, meta);
  }
  info(message: string, meta?: unknown): void {
    this.#emit('info', message, meta);
  }
  warn(message: string, meta?: unknown): void {
    this.#emit('warn', message, meta);
  }
  error(message: string, meta?: unknown): void {
    this.#emit('error', message, meta);
  }
}

/** Shared default logger. */
export const logger = new Logger({
  level: (process.env.AGENT_STUDIO_LOG_LEVEL as LogLevel) || 'info',
});
