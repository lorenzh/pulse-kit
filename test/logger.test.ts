import assert from "node:assert/strict";
import { test } from "node:test";
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
