export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

const SECRET_PATTERNS: [RegExp, string][] = [
  // Jooble puts the key in the path: https://jooble.org/api/<key>
  [/(jooble\.org\/api\/)[^/?\s"']+/gi, '$1***'],
  // Generic query-string secrets.
  [/([?&](?:api_?key|apikey|key|token|access_token|affid|password|secret)=)[^&\s"']+/gi, '$1***'],
  // Credentials embedded in proxy URLs: http://user:pass@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1***:***@'],
];

/** Removes API keys, tokens and proxy credentials from any string before it is logged. */
export function redact(value: string): string {
  let out = value;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return /[\s"=]/.test(v) || v === '' ? JSON.stringify(v) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Error) return JSON.stringify(v.message);
  return JSON.stringify(v);
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(scope: string): Logger;
  /** Write a raw, pre-formatted block (source report tables) regardless of format. */
  raw(text: string): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: 'pretty' | 'json';
  scope?: string;
  write?: (line: string) => void;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? 'info';
  const format = opts.format ?? 'pretty';
  // Logs go to stderr so CLI stdout can carry JSON/CSV output cleanly.
  const write = opts.write ?? ((line: string) => process.stderr.write(line + '\n'));
  const scope = opts.scope;

  const emit = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const ts = new Date().toISOString();
    if (format === 'json') {
      const payload: LogFields = { ts, level: lvl, ...(scope ? { scope } : {}), msg, ...fields };
      write(redact(JSON.stringify(payload)));
      return;
    }
    const kv = fields
      ? Object.entries(fields)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${formatValue(v)}`)
          .join(' ')
      : '';
    const prefix = scope ? `[${scope}] ` : '';
    write(redact(`${ts} ${lvl.toUpperCase().padEnd(5)} ${prefix}${msg}${kv ? ' ' + kv : ''}`));
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (s) => createLogger({ ...opts, level, format, write, scope: s }),
    raw: (text) => write(redact(text)),
  };
}

export const silentLogger: Logger = createLogger({ write: () => {} });
