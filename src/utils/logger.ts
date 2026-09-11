import { env } from '../config/env.js';

const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
type Level = (typeof LEVELS)[number];

const SENSITIVE_KEYS = new Set(['api_key', 'apiKey', 'ODOO_API_KEY', 'password', 'token', 'uid', 'ODOO_UID']);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(key) ? '***REDACTED***' : redact(val);
    }
    return out;
  }
  return value;
}

function shouldLog(level: Level): boolean {
  return LEVELS.indexOf(level) <= LEVELS.indexOf(env.LOG_LEVEL);
}

function write(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta: redact(meta) } : {}),
  };
  // Toujours sur stderr : stdout est réservé au protocole MCP stdio.
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
};
