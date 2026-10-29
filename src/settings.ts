export type Env = Readonly<Record<string, string | undefined>>;

/** The only startup and config error class of the pulse services. */
export class StartupError extends Error {
  readonly setting: string | undefined;

  constructor(message: string, opts: { setting?: string | undefined; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "StartupError";
    this.setting = opts.setting;
  }
}

interface Describe {
  /** Replaces the rule text of the error message. */
  describe?: string;
}

function invalid(name: string, rule: string): StartupError {
  return new StartupError(`${name}: ${rule}`, { setting: name });
}

/** The trimmed value, or undefined when unset or blank. */
export function readString(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function readInteger(raw: string, min: number, max: number): number | undefined {
  if (!/^-?\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

export function readMs(
  env: Env,
  name: string,
  opts: { fallback: number; min: number; max?: number } & Describe,
): number {
  const raw = readString(env, name);
  if (raw === undefined) return opts.fallback;
  const value = readInteger(raw, opts.min, opts.max ?? Number.MAX_SAFE_INTEGER);
  if (value !== undefined) return value;
  const rule =
    opts.max === undefined
      ? `must be an integer >= ${opts.min}`
      : `must be an integer from ${opts.min} to ${opts.max}`;
  throw invalid(name, opts.describe ?? rule);
}

export function readPort(
  env: Env,
  name: string,
  opts: { fallback?: number; min?: number } & Describe = {},
): number | undefined {
  const raw = readString(env, name);
  if (raw === undefined) return opts.fallback;
  const value = readInteger(raw, opts.min ?? 0, 65535);
  if (value !== undefined) return value;
  throw invalid(name, opts.describe ?? `must be an integer from ${opts.min ?? 0} to 65535`);
}

function parseUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    // An unparsable value is reported as an invalid setting by the caller.
    return undefined;
  }
}

function urlRule(opts: { allowCredentials?: boolean; allowQueryOrFragment?: boolean }): string {
  const banned: string[] = [];
  if (opts.allowCredentials !== true) banned.push("credentials");
  if (opts.allowQueryOrFragment !== true) banned.push("query", "fragment");
  if (banned.length === 0) return "must be an http(s) URL";
  const last = banned.pop();
  const list = banned.length === 0 ? `${last}` : `${banned.join(", ")} or ${last}`;
  return `must be an http(s) URL without ${list}`;
}

export function readUrl(
  env: Env,
  name: string,
  opts: {
    protocols?: readonly string[];
    allowCredentials?: boolean;
    allowQueryOrFragment?: boolean;
  } & Describe = {},
): string | undefined {
  const raw = readString(env, name);
  if (raw === undefined) return undefined;
  const url = parseUrl(raw);
  const protocols = opts.protocols ?? ["http:", "https:"];
  const isValid =
    url !== undefined &&
    protocols.includes(url.protocol) &&
    url.hostname !== "" &&
    (opts.allowCredentials === true || (url.username === "" && url.password === "")) &&
    (opts.allowQueryOrFragment === true || (url.search === "" && url.hash === ""));
  if (!isValid) throw invalid(name, opts.describe ?? urlRule(opts));
  return url.href.replace(/\/$/, "");
}

export function readEnum<T extends string>(
  env: Env,
  name: string,
  values: readonly T[],
  fallback: T,
  opts: Describe = {},
): T {
  const raw = readString(env, name);
  if (raw === undefined) return fallback;
  const match = values.find((v) => v === raw);
  if (match !== undefined) return match;
  throw invalid(name, opts.describe ?? `must be one of ${values.join(", ")}`);
}

export function readBool(env: Env, name: string, fallback: boolean, opts: Describe = {}): boolean {
  const raw = readString(env, name);
  if (raw === undefined) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw invalid(name, opts.describe ?? "must be true, false, 1 or 0");
}
