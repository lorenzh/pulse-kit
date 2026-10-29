import { type Env, readEnum } from "./settings.ts";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  now?: () => number;
  /** Receives the JSON line without a newline. Default: warn and error to stderr, others to stdout. */
  write?: (level: LogLevel, line: string) => void;
}

const BASE_KEYS = new Set(["time", "level", "msg"]);

function writeToStream(level: LogLevel, line: string): void {
  if (level === "warn" || level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/** PULSE_LOG_LEVEL, default info. */
export function readLogLevel(env: Env): LogLevel {
  return readEnum(env, "PULSE_LOG_LEVEL", LOG_LEVELS, "info");
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const threshold = LOG_LEVELS.indexOf(opts.level ?? "info");
  const now = opts.now ?? Date.now;
  const write = opts.write ?? writeToStream;
  const emit = (level: LogLevel, msg: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    const line: LogFields = { time: new Date(now()).toISOString(), level, msg };
    for (const [key, value] of Object.entries(fields)) {
      // A field never overrides time, level or msg.
      if (!BASE_KEYS.has(key)) line[key] = value;
    }
    write(level, JSON.stringify(line));
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
