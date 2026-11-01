import { test } from "bun:test";
import assert from "node:assert/strict";
import { createLogger } from "../src/logger.ts";
import { runService } from "../src/run-service.ts";
import { StartupError } from "../src/settings.ts";

function fakes() {
  const handlers = new Map<string, () => void>();
  const exits: number[] = [];
  const stderr: string[] = [];
  const logs: string[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  return {
    handlers,
    exits,
    stderr,
    logs,
    timers,
    log: createLogger({ now: () => 0, write: (_l, line) => logs.push(line) }),
    proc: {
      on: (sig: string, fn: () => void) => handlers.set(sig, fn),
      exit: (code: number) => exits.push(code),
      stderr: { write: (s: string) => stderr.push(s) },
    },
    setTimeout: ((fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((t: { cleared: boolean }) => {
      t.cleared = true;
    }) as unknown as typeof clearTimeout,
  };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

test("StartupError prints a prefixed line and exits 2", async () => {
  const f = fakes();
  await runService({
    ...f,
    service: "probe",
    timeoutMs: 10,
    start: async () => {
      throw new StartupError("A: bad");
    },
    stop: async () => {},
  });
  assert.deepEqual(f.stderr, ["pulse-probe: A: bad\n"]);
  assert.deepEqual(f.exits, [2]);
});

test("other start errors exit 1, via the logger or stderr", async () => {
  const f = fakes();
  await runService({
    ...f,
    service: "x",
    timeoutMs: 10,
    start: async () => {
      throw new Error("boom");
    },
    stop: async () => {},
  });
  assert.deepEqual(f.exits, [1]);
  assert.match(f.logs[0] ?? "", /startup failed.*boom/);
  const g = fakes();
  await runService({
    proc: g.proc,
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    service: "x",
    timeoutMs: 10,
    start: async () => {
      throw new Error("boom");
    },
    stop: async () => {},
  });
  assert.deepEqual(g.stderr, ["pulse-x: startup failed: boom\n"]);
});

test("registers signals before start; signal stops cleanly and clears the timer", async () => {
  const f = fakes();
  const stops: string[] = [];
  let registeredAtStart = 0;
  await runService({
    ...f,
    service: "x",
    timeoutMs: 50,
    start: async () => {
      registeredAtStart = f.handlers.size;
    },
    stop: async (s) => {
      stops.push(s);
    },
  });
  assert.equal(registeredAtStart, 2);
  f.handlers.get("SIGTERM")?.();
  f.handlers.get("SIGINT")?.();
  await tick();
  assert.deepEqual(stops, ["SIGTERM"]);
  assert.deepEqual(f.exits, [0]);
  assert.equal(f.timers[0]?.cleared, true);
  assert.match(f.logs[0] ?? "", /shutting down.*SIGTERM/);
});

test("a signal during start waits for start to settle", async () => {
  const f = fakes();
  let release: () => void = () => {};
  const stops: string[] = [];
  const done = runService({
    ...f,
    service: "x",
    timeoutMs: 50,
    start: () =>
      new Promise<void>((r) => {
        release = r;
      }),
    stop: async (s) => {
      stops.push(s);
    },
  });
  f.handlers.get("SIGINT")?.();
  await tick();
  assert.deepEqual(stops, []);
  release();
  await done;
  await tick();
  assert.deepEqual(stops, ["SIGINT"]);
  assert.deepEqual(f.exits, [0]);
});

test("a stop that hangs exits after the timeout with timeoutExitCode", async () => {
  const f = fakes();
  await runService({
    ...f,
    service: "x",
    timeoutMs: 50,
    timeoutExitCode: 3,
    start: async () => {},
    stop: () => new Promise<void>(() => {}),
  });
  f.handlers.get("SIGTERM")?.();
  await tick();
  assert.equal(f.timers[0]?.ms, 50);
  f.timers[0]?.fn();
  assert.deepEqual(f.exits, [3]);
  assert.match(
    f.logs[1] ?? "",
    /shutdown did not finish within 50ms; exiting anyway.*"timeoutMs":50/,
  );
});

test("timeout exit code defaults to 1", async () => {
  const f = fakes();
  let release = (): void => {};
  await runService({
    ...f,
    service: "x",
    timeoutMs: 5,
    start: async () => {},
    stop: () =>
      new Promise<void>((r) => {
        release = r;
      }),
  });
  f.handlers.get("SIGTERM")?.();
  await tick();
  f.timers[0]?.fn();
  assert.deepEqual(f.exits, [1]);
  release();
  await tick();
  f.handlers.get("SIGINT")?.();
  await tick();
  assert.deepEqual(f.exits, [1]);
});

for (const [label, extra] of [
  ["timeoutExitCode 0", { timeoutExitCode: 0 }],
  ["timeoutExitCode -1", { timeoutExitCode: -1 }],
  ["timeoutExitCode 256", { timeoutExitCode: 256 }],
  ["timeoutExitCode 1.5", { timeoutExitCode: 1.5 }],
  ["timeoutMs 2147483648", { timeoutMs: 2147483648 }],
  ["timeoutMs 0", { timeoutMs: 0 }],
] as const) {
  test(`${label} rejects with RangeError before handlers and start`, async () => {
    const f = fakes();
    let starts = 0;
    await assert.rejects(
      runService({
        ...f,
        service: "x",
        timeoutMs: 5,
        ...extra,
        start: async () => {
          starts += 1;
        },
        stop: async () => {},
      }),
      RangeError,
    );
    assert.equal(f.handlers.size, 0);
    assert.equal(starts, 0);
    assert.deepEqual(f.exits, []);
  });
}

test("a stop that throws exits 1", async () => {
  const f = fakes();
  await runService({
    ...f,
    service: "x",
    timeoutMs: 5,
    start: async () => {},
    stop: async () => {
      throw new Error("bad");
    },
  });
  f.handlers.get("SIGTERM")?.();
  await tick();
  assert.deepEqual(f.exits, [1]);
});
