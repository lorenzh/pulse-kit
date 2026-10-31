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

const UNSERIALIZABLE = '"[Unserializable]"';

/**
 * `"key":json` for one field: BigInt as decimal string, a cycle as "[Circular]".
 * The value is serialized inside a one-key object so `toJSON` still receives the field key.
 */
function serializeEntry(key: string, value: unknown): string {
  // A callable "toJSON" field would run as the wrapper's serializer; functions are dropped anyway.
  if (key === "toJSON" && typeof value === "function") return "";
  // Objects on the path from the root to the current value; a repeat off this path is no cycle.
  const ancestors: unknown[] = [];
  const json = JSON.stringify(
    { [key]: value },
    function (this: unknown, _key: string, v: unknown): unknown {
      if (typeof v === "bigint") return v.toString();
      if (typeof v !== "object" || v === null) return v;
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop();
      if (ancestors.includes(v)) return "[Circular]";
      ancestors.push(v);
      return v;
    },
  );
  // Strip the wrapper braces; an undefined value leaves "".
  return json.slice(1, -1);
}

function fieldPart(fields: LogFields, key: string): string {
  try {
    return serializeEntry(key, fields[key]);
  } catch {
    // A throwing getter or toJSON may carry the value in its text, so only a fixed marker is written.
    return `${JSON.stringify(key)}:${UNSERIALIZABLE}`;
  }
}

function fieldParts(fields: LogFields): string {
  let keys: string[];
  try {
    keys = Object.keys(fields);
  } catch {
    // The fields object itself cannot be enumerated, e.g. a Proxy with a throwing ownKeys.
    return `,"fields":${UNSERIALIZABLE}`;
  }
  let out = "";
  for (const key of keys) {
    // A field never overrides time, level or msg.
    if (BASE_KEYS.has(key)) continue;
    const part = fieldPart(fields, key);
    if (part !== "") out += `,${part}`;
  }
  return out;
}

function timeOf(now: () => number): string | null {
  try {
    return new Date(now()).toISOString();
  } catch {
    // A throwing clock or an invalid date gives "time":null instead of a lost line.
    return null;
  }
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const threshold = LOG_LEVELS.indexOf(opts.level ?? "info");
  const now = opts.now ?? Date.now;
  const write = opts.write ?? writeToStream;
  const emit = (level: LogLevel, msg: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    const base = `{"time":${JSON.stringify(timeOf(now))},"level":${JSON.stringify(level)},"msg":${JSON.stringify(String(msg))}`;
    const line = `${base}${fieldParts(fields)}}`;
    try {
      write(level, line);
    } catch {
      // Logging must never throw; there is nowhere left to report a failed write.
    }
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
