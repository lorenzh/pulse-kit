import { describe, expect, test } from "bun:test";
import { clientKeyOf, createFailureLimiter, type FailureLimiter } from "../src/failure-limiter.ts";

function setup(
  limit: number,
  maxKeys: number,
): { limiter: FailureLimiter; at: (t: number) => void } {
  let t = 0;
  const limiter = createFailureLimiter({ limit, windowMs: 60_000, maxKeys, now: () => t });
  return {
    limiter,
    at: (next) => {
      t = next;
    },
  };
}

/** Checks, then records when not blocked. Returns whether the failure was evaluated. */
function attempt(limiter: FailureLimiter, key: string): boolean {
  if (limiter.check(key).isBlocked) return false;
  limiter.recordFailure(key);
  return true;
}

interface ModelWindow {
  start: number;
  count: number;
  isOverflow: boolean;
}

interface Model {
  windows: ModelWindow[];
  isBlocked(key: string, t: number): boolean;
  record(key: string, t: number): void;
  ownOpenedDuringOverflow(): number;
}

/** Reference model of the routing rule, written from the spec text, not from the module. */
function createModel(o: { limit: number; windowMs: number; maxKeys: number }): Model {
  const own = new Map<string, ModelWindow>();
  let overflow: ModelWindow | undefined;
  let violations = 0;
  const windows: ModelWindow[] = [];
  const isLive = (w: ModelWindow | undefined, t: number): w is ModelWindow =>
    w !== undefined && t < w.start + o.windowMs;
  const routeOf = (key: string, t: number): "own" | "overflow" | "new" => {
    for (const [k, w] of own) if (!isLive(w, t)) own.delete(k);
    if (isLive(own.get(key), t)) return "own";
    return own.size >= o.maxKeys || isLive(overflow, t) ? "overflow" : "new";
  };
  return {
    windows,
    isBlocked(key, t) {
      const r = routeOf(key, t);
      if (r === "new") return false;
      const w = r === "own" ? own.get(key) : overflow;
      return isLive(w, t) && w.count >= o.limit;
    },
    record(key, t) {
      const r = routeOf(key, t);
      const w = r === "own" ? own.get(key) : overflow;
      if (r !== "new" && isLive(w, t)) {
        w.count++;
        return;
      }
      const opened = { start: t, count: 1, isOverflow: r === "overflow" };
      if (r === "overflow") overflow = opened;
      else {
        if (isLive(overflow, t)) violations++;
        own.set(key, opened);
      }
      windows.push(opened);
    },
    ownOpenedDuringOverflow: () => violations,
  };
}

describe("createFailureLimiter", () => {
  test("blocks at the limit and unblocks exactly at the window end", () => {
    const t0 = 1_700_000_000_000;
    const { limiter, at } = setup(10, 100);
    at(t0);
    for (let i = 0; i < 9; i++) limiter.recordFailure("a");
    expect(limiter.check("a")).toEqual({ isBlocked: false });
    limiter.recordFailure("a");
    expect(limiter.check("a")).toEqual({ isBlocked: true, retryAfterMs: 60_000 });
    at(t0 + 59_001);
    expect(limiter.check("a")).toEqual({ isBlocked: true, retryAfterMs: 999 });
    at(t0 + 60_000);
    expect(limiter.check("a")).toEqual({ isBlocked: false });
    limiter.recordFailure("a");
    // A new window with count 1: 9 more failures are needed to block.
    for (let i = 0; i < 8; i++) limiter.recordFailure("a");
    expect(limiter.check("a")).toEqual({ isBlocked: false });
    limiter.recordFailure("a");
    expect(limiter.check("a").isBlocked).toBe(true);
  });

  test("check alone consumes no budget", () => {
    const { limiter } = setup(10, 100);
    for (let i = 0; i < 100; i++) expect(limiter.check("a")).toEqual({ isBlocked: false });
    for (let i = 0; i < 9; i++) limiter.recordFailure("a");
    expect(limiter.check("a").isBlocked).toBe(false);
    limiter.recordFailure("a");
    expect(limiter.check("a").isBlocked).toBe(true);
  });

  test("overflow: a full table routes new keys to overflow without eviction", () => {
    const { limiter, at } = setup(2, 3);
    for (const key of ["a", "b", "c"]) limiter.recordFailure(key);
    limiter.recordFailure("d");
    limiter.recordFailure("d");
    expect(limiter.check("e")).toEqual({ isBlocked: true, retryAfterMs: 60_000 });
    expect(limiter.check("a")).toEqual({ isBlocked: false });
    at(60_000);
    expect(limiter.check("e")).toEqual({ isBlocked: false });
    // Ended windows freed capacity: three new keys get own windows again.
    for (const key of ["x", "y", "z"]) limiter.recordFailure(key);
    limiter.recordFailure("x");
    expect(limiter.check("x").isBlocked).toBe(true);
    expect(limiter.check("e")).toEqual({ isBlocked: false });
  });

  test("overflow recovery: no own window while overflow is live", () => {
    const { limiter, at } = setup(2, 1);
    let evaluated = 0;
    const tryAt = (t: number, key: string): void => {
      at(t);
      if (attempt(limiter, key) && t >= 1 && t < 60_001) evaluated++;
    };
    tryAt(0, "a");
    tryAt(1, "a");
    tryAt(1, "d");
    tryAt(1, "d");
    at(60_000);
    expect(limiter.check("d")).toEqual({ isBlocked: true, retryAfterMs: 1 });
    expect(limiter.check("a")).toEqual({ isBlocked: true, retryAfterMs: 1 });
    tryAt(60_000, "a");
    tryAt(60_000, "d");
    at(60_001);
    expect(limiter.check("d")).toEqual({ isBlocked: false });
    limiter.recordFailure("d");
    limiter.recordFailure("d");
    // d now has an own window [60001, 120001), so a goes to the (ended) overflow slot.
    expect(limiter.check("d")).toEqual({ isBlocked: true, retryAfterMs: 60_000 });
    expect(evaluated).toBe(3);
  });

  test("global bound: fixed windows can count twice in one interval", () => {
    const { limiter, at } = setup(2, 1);
    const times: number[] = [];
    const tryAt = (t: number, key: string): void => {
      at(t);
      if (attempt(limiter, key)) times.push(t);
    };
    tryAt(0, "a");
    tryAt(59_999, "a");
    tryAt(60_000, "a");
    tryAt(60_000, "a");
    tryAt(60_000, "d");
    tryAt(60_000, "d");
    expect(times.filter((t) => t >= 59_999 && t < 119_999)).toHaveLength(5);
  });

  test("scripted run keeps every window and interval within the bound", () => {
    const windowMs = 60_000;
    let t = 0;
    const limiter = createFailureLimiter({ limit: 3, windowMs, maxKeys: 2, now: () => t });
    const model = createModel({ limit: 3, windowMs, maxKeys: 2 });
    const keys = ["a", "b", "c", "d", "e", "f"];
    const evaluated: number[] = [];
    for (let step = 0; step < 360; step++) {
      t = step * 500;
      const key = keys[(step * 7 + Math.floor(step / 6)) % 6] ?? "a";
      const isBlocked = model.isBlocked(key, t);
      expect(limiter.check(key).isBlocked).toBe(isBlocked);
      if (isBlocked) continue;
      limiter.recordFailure(key);
      model.record(key, t);
      evaluated.push(t);
    }
    expect(model.windows.some((w) => w.isOverflow)).toBe(true);
    expect(model.ownOpenedDuringOverflow()).toBe(0);
    for (const w of model.windows) expect(w.count).toBeLessThanOrEqual(3);
    expect(evaluated[evaluated.length - 1] ?? 0).toBeGreaterThanOrEqual(120_000);
    let worst = 0;
    for (let s = -windowMs; s <= 180_000; s++) {
      worst = Math.max(worst, evaluated.filter((e) => e >= s && e < s + windowMs).length);
    }
    expect(worst).toBeLessThanOrEqual(18);
  });

  test("retryAfterMs stays in 1..windowMs when the clock goes backwards", () => {
    const { limiter, at } = setup(1, 10);
    at(100_000);
    limiter.recordFailure("a");
    at(10_000);
    expect(limiter.check("a")).toEqual({ isBlocked: true, retryAfterMs: 60_000 });
    at(159_999);
    expect(limiter.check("a")).toEqual({ isBlocked: true, retryAfterMs: 1 });
  });

  test.each([
    { limit: 0, maxKeys: 10, windowMs: 60_000 },
    { limit: 1_000_001, maxKeys: 10, windowMs: 60_000 },
    { limit: 10, maxKeys: 1.5, windowMs: 60_000 },
    { limit: 10, maxKeys: 0, windowMs: 60_000 },
    { limit: 10, maxKeys: 1_000_001, windowMs: 60_000 },
    { limit: 10, maxKeys: 10, windowMs: 0 },
    { limit: 10, maxKeys: 10, windowMs: 2_147_483_648 },
    { limit: Number.NaN, maxKeys: 10, windowMs: 60_000 },
  ])("rejects invalid options %o", (opts) => {
    expect(() => createFailureLimiter({ ...opts, now: () => 0 })).toThrow(RangeError);
  });

  test("accepts the upper bounds", () => {
    expect(() =>
      createFailureLimiter({
        limit: 1_000_000,
        maxKeys: 1_000_000,
        windowMs: 2_147_483_647,
        now: () => 0,
      }),
    ).not.toThrow();
  });
});

describe("createFailureLimiter after a backward clock jump", () => {
  const scenario = (): { limiter: FailureLimiter } => {
    let t = 1000;
    const limiter = createFailureLimiter({ limit: 2, maxKeys: 4, windowMs: 60_000, now: () => t });
    const fail = (key: string): void => {
      expect(limiter.check(key)).toEqual({ isBlocked: false });
      limiter.recordFailure(key);
    };
    fail("a");
    t = 0;
    for (const k of ["p1", "p2", "p3"]) fail(k);
    t = 60_000;
    fail("c");
    fail("c");
    return { limiter };
  };
  const cases: { name: string; run: (l: FailureLimiter) => unknown; expected: unknown }[] = [
    { name: "check of a fresh key", run: (l) => l.check("fresh"), expected: { isBlocked: false } },
    {
      name: "recordFailure of a fresh key opens an own window",
      run: (l) => {
        l.recordFailure("fresh");
        l.recordFailure("fresh");
        return [l.check("fresh"), l.check("other")];
      },
      expected: [{ isBlocked: true, retryAfterMs: 60_000 }, { isBlocked: false }],
    },
    {
      name: "check of the key that used its own window",
      run: (l) => l.check("c"),
      expected: { isBlocked: true, retryAfterMs: 60_000 },
    },
  ];
  for (const c of cases) {
    test(`ended windows free capacity: ${c.name}`, () => {
      const { limiter } = scenario();
      expect(c.run(limiter)).toEqual(c.expected);
    });
  }
});

describe("clientKeyOf", () => {
  /* eslint-disable sonarjs/no-hardcoded-ip -- literal addresses are the inputs under test */
  test.each([
    ["127.0.0.1", "127.0.0.1"],
    ["::ffff:127.0.0.1", "127.0.0.1"],
    ["::FFFF:7f00:1", "127.0.0.1"],
    ["[2001:db8::1]", "2001:db8:0:0::/64"],
    ["2001:db8::2", "2001:db8:0:0::/64"],
    ["2001:db8:0:1::1", "2001:db8:0:1::/64"],
    ["2001:DB8:0:1:aa::1", "2001:db8:0:1::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["64:ff9b::192.0.2.1", "64:ff9b:0:0::/64"],
    [" 10.0.0.1 ", "10.0.0.1"],
    ["", "unknown"],
    ["not-an-ip", "unknown"],
  ])("%p → %p", (input, expected) => {
    expect(clientKeyOf(input)).toBe(expected);
  });
  /* eslint-enable sonarjs/no-hardcoded-ip */

  test("undefined → unknown", () => {
    expect(clientKeyOf(undefined)).toBe("unknown");
  });
});
