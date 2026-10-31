import { test } from "bun:test";
import assert from "node:assert/strict";
import { createLogger, LOG_LEVELS, readLogLevel } from "../src/logger.ts";
import { StartupError } from "../src/settings.ts";

test("writes JSON with base keys first and not overridable", () => {
  const lines: [string, string][] = [];
  const log = createLogger({ now: () => 0, write: (l, line) => lines.push([l, line]) });
  log.info("hello", { a: 1, msg: "x", level: "y", time: "z" });
  assert.deepEqual(lines, [
    ["info", '{"time":"1970-01-01T00:00:00.000Z","level":"info","msg":"hello","a":1}'],
  ]);
});

test("filters below the level", () => {
  const seen: string[] = [];
  const log = createLogger({ level: "warn", write: (l) => seen.push(l) });
  log.debug("a");
  log.info("b");
  log.warn("c");
  log.error("d");
  assert.deepEqual(seen, ["warn", "error"]);
});

test("default sink writes warn and error to stderr, others to stdout", () => {
  const out: string[] = [];
  const err: string[] = [];
  const o = process.stdout.write;
  const e = process.stderr.write;
  process.stdout.write = ((s: string) => {
    out.push(s);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => {
    err.push(s);
    return true;
  }) as typeof process.stderr.write;
  try {
    const log = createLogger();
    log.info("i");
    log.error("e");
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
  assert.equal(out.length, 1);
  assert.equal(err.length, 1);
  assert.ok(out[0]?.endsWith("\n"));
});

test("readLogLevel", () => {
  assert.equal(readLogLevel({}), "info");
  for (const l of LOG_LEVELS) assert.equal(readLogLevel({ PULSE_LOG_LEVEL: l }), l);
  assert.throws(
    () => readLogLevel({ PULSE_LOG_LEVEL: "loud" }),
    (err) =>
      err instanceof StartupError &&
      err.message === "PULSE_LOG_LEVEL: must be one of debug, info, warn, error",
  );
});

function capture(now: () => number = () => 0): {
  lines: string[];
  log: ReturnType<typeof createLogger>;
} {
  const lines: string[] = [];
  return { lines, log: createLogger({ now, write: (_l, line) => lines.push(line) }) };
}

function parsed(line: string | undefined): Record<string, unknown> {
  const value: unknown = JSON.parse(line ?? "");
  assert.ok(typeof value === "object" && value !== null);
  return value as Record<string, unknown>;
}

test("BigInt and circular fields write one parseable line", () => {
  const { lines, log } = capture();
  const a: Record<string, unknown> = { name: "x" };
  a.self = a;
  log.info("m", { n: 10n });
  log.info("m", { a });
  log.info("m", { n: -5n, a });
  assert.equal(lines.length, 3);
  for (const line of lines) {
    const p = parsed(line);
    assert.equal(p.time, "1970-01-01T00:00:00.000Z");
    assert.equal(p.level, "info");
    assert.equal(p.msg, "m");
  }
  assert.equal(parsed(lines[0]).n, "10");
  assert.deepEqual(parsed(lines[1]).a, { name: "x", self: "[Circular]" });
  assert.equal(
    lines[2],
    '{"time":"1970-01-01T00:00:00.000Z","level":"info","msg":"m","n":"-5","a":{"name":"x","self":"[Circular]"}}',
  );
});

test("a repeated reference without a cycle is written in full", () => {
  const { lines, log } = capture();
  const o = { k: 1 };
  log.info("m", { a: o, b: o, c: [o, o] });
  assert.equal(
    lines[0],
    '{"time":"1970-01-01T00:00:00.000Z","level":"info","msg":"m","a":{"k":1},"b":{"k":1},"c":[{"k":1},{"k":1}]}',
  );
});

test("a throwing getter or toJSON marks only that field, without its text", () => {
  const { lines, log } = capture();
  const getter = Object.defineProperty({}, "x", {
    enumerable: true,
    get: () => {
      throw new Error("secret-sentinel");
    },
  });
  const toJSON = {
    toJSON: () => {
      throw new Error("secret-sentinel");
    },
  };
  log.info("m", { g: getter, ok: 1 });
  log.info("m", { t: toJSON, ok: 2 });
  assert.deepEqual(parsed(lines[0]), {
    time: "1970-01-01T00:00:00.000Z",
    level: "info",
    msg: "m",
    g: "[Unserializable]",
    ok: 1,
  });
  assert.equal(parsed(lines[1]).t, "[Unserializable]");
  assert.equal(parsed(lines[1]).ok, 2);
  for (const line of lines) assert.ok(!line.includes("secret-sentinel"));
});

test("a throwing top-level getter marks only that field", () => {
  let line = "";
  const fields = {
    get bad(): unknown {
      throw new Error("secret-sentinel");
    },
    ok: 1,
  };
  createLogger({
    now: () => 0,
    write: (_, l) => {
      line = l;
    },
  }).info("m", fields);
  assert.equal(
    line,
    '{"time":"1970-01-01T00:00:00.000Z","level":"info","msg":"m","bad":"[Unserializable]","ok":1}',
  );
});

test("toJSON receives the field key", () => {
  let line = "";
  const x = { toJSON: (key: string): string => `k:${key}` };
  createLogger({
    now: () => 0,
    write: (_, l) => {
      line = l;
    },
  }).info("m", { x, u: undefined });
  assert.equal(line, '{"time":"1970-01-01T00:00:00.000Z","level":"info","msg":"m","x":"k:x"}');
});

test("fields that cannot be enumerated give fields [Unserializable]", () => {
  const { lines, log } = capture();
  const fields = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error("secret-sentinel");
      },
    },
  );
  log.warn("m", fields);
  assert.equal(
    lines[0],
    '{"time":"1970-01-01T00:00:00.000Z","level":"warn","msg":"m","fields":"[Unserializable]"}',
  );
});

test("a bad clock gives time null and a throwing write is ignored", () => {
  const nan = capture(() => Number.NaN);
  nan.log.info("m");
  assert.equal(nan.lines[0], '{"time":null,"level":"info","msg":"m"}');
  const throwing = capture(() => {
    throw new Error("clock");
  });
  throwing.log.info("m");
  assert.equal(throwing.lines[0], '{"time":null,"level":"info","msg":"m"}');
  const log = createLogger({
    write: () => {
      throw new Error("write");
    },
  });
  assert.doesNotThrow(() => log.error("m"));
});

test("undefined, functions and symbols stay dropped; Date serializes as before", () => {
  const { lines, log } = capture();
  log.info("m", { u: undefined, f: () => 1, s: Symbol("s"), d: new Date(0), level: "x" });
  assert.equal(
    lines[0],
    '{"time":"1970-01-01T00:00:00.000Z","level":"info","msg":"m","d":"1970-01-01T00:00:00.000Z"}',
  );
});
