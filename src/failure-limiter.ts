import { isIP } from "node:net";
import { normalizeAddress } from "./ip-classifier.ts";
import { MAX_TIMER_DELAY_MS } from "./timer.ts";

/**
 * Fixed-window failure limiter with a bounded key table.
 *
 * Each key gets an own window `{ windowStart, count }` that lasts `windowMs` from the failure that
 * opened it. At most `maxKeys` own windows exist; one extra overflow window is shared by every key
 * that finds no room. Both methods use one routing rule at the same `now()`: a key with a live own
 * window uses it; otherwise it uses the overflow window when the table holds `maxKeys` live
 * entries or the overflow window is live; otherwise it gets a new own window.
 *
 * Recovery: an own window is never opened while the overflow window is live, so a key that failed
 * in overflow gets a fresh own budget only after the overflow window has ended.
 *
 * Bound: when callers record a failure only after a check that was not blocked, each window holds
 * at most `limit` evaluated failures and at most `maxKeys + 1` windows are live. A window that ends
 * inside an interval and the next one that starts inside it can both count, so any interval of
 * `windowMs` ms holds at most `2 × (maxKeys + 1) × limit` evaluated failures (factor 2).
 */

export interface FailureLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys: number;
  now: () => number;
}

export type FailureCheck = { isBlocked: false } | { isBlocked: true; retryAfterMs: number };

export interface FailureLimiter {
  check(key: string): FailureCheck;
  recordFailure(key: string): void;
}

interface Window {
  windowStart: number;
  count: number;
}

const MAX_COUNT = 1_000_000;

function assertInteger(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${name} must be an integer from 1 to ${max}`);
  }
}

/** Creates a limiter. Invalid options throw `RangeError`. Holds no timers. */
export function createFailureLimiter(options: FailureLimiterOptions): FailureLimiter {
  const { limit, windowMs, maxKeys, now } = options;
  assertInteger("limit", limit, MAX_COUNT);
  assertInteger("maxKeys", maxKeys, MAX_COUNT);
  assertInteger("windowMs", windowMs, MAX_TIMER_DELAY_MS);

  // Insertion order equals window start order, so ended windows sit at the front.
  const own = new Map<string, Window>();
  let overflow: Window | undefined;
  let latestStart = Number.NEGATIVE_INFINITY;

  const isLive = (w: Window, t: number): boolean => t < w.windowStart + windowMs;

  const dropEnded = (t: number): void => {
    for (const [key, w] of own) {
      if (isLive(w, t)) break;
      own.delete(key);
    }
    if (overflow !== undefined && !isLive(overflow, t)) overflow = undefined;
  };

  type Route = { kind: "own"; window: Window } | { kind: "overflow" } | { kind: "new" };

  const route = (key: string, t: number): Route => {
    const w = own.get(key);
    if (w !== undefined && isLive(w, t)) return { kind: "own", window: w };
    const isOverflowLive = overflow !== undefined && isLive(overflow, t);
    if (own.size >= maxKeys || isOverflowLive) return { kind: "overflow" };
    return { kind: "new" };
  };

  const routedWindow = (r: Route): Window | undefined => {
    switch (r.kind) {
      case "own":
        return r.window;
      case "overflow":
        return overflow;
      case "new":
        return undefined;
      default: {
        const never: never = r;
        return never;
      }
    }
  };

  return {
    check(key) {
      const t = now();
      dropEnded(t);
      const w = routedWindow(route(key, t));
      if (w === undefined || !isLive(w, t) || w.count < limit) return { isBlocked: false };
      const remaining = w.windowStart + windowMs - t;
      return { isBlocked: true, retryAfterMs: Math.min(windowMs, Math.max(1, remaining)) };
    },
    recordFailure(key) {
      const t = now();
      dropEnded(t);
      const r = route(key, t);
      switch (r.kind) {
        case "own":
          r.window.count = Math.min(limit, r.window.count + 1);
          return;
        case "overflow":
          if (overflow !== undefined && isLive(overflow, t)) {
            overflow.count = Math.min(limit, overflow.count + 1);
          } else {
            overflow = { windowStart: t, count: 1 };
          }
          return;
        case "new":
          // Delete first so the re-added key moves to the end and keeps start order.
          own.delete(key);
          own.set(key, { windowStart: t, count: 1 });
          // The clock moved backward: re-sort so dropEnded can stop at the first live entry.
          if (t < latestStart) {
            const sorted = [...own].sort(([, a], [, b]) => a.windowStart - b.windowStart);
            own.clear();
            for (const [k, w] of sorted) own.set(k, w);
          }
          latestStart = Math.max(latestStart, t);
          return;
        default: {
          const never: never = r;
          return never;
        }
      }
    },
  };
}

// Input already passed `isIP(...) === 6`, so the groups are valid hex.
function expandIpv6(address: string): number[] {
  let text = address;
  const lastColon = text.lastIndexOf(":");
  const last = text.slice(lastColon + 1);
  if (last.includes(".")) {
    const [a = 0, b = 0, c = 0, d = 0] = last.split(".").map(Number);
    text = `${text.slice(0, lastColon + 1)}${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`;
  }
  const parse = (part: string): number[] =>
    part === "" ? [] : part.split(":").map((g) => Number.parseInt(g, 16));
  const [left = "", right] = text.split("::");
  const head = parse(left);
  if (right === undefined) return head;
  const tail = parse(right);
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/**
 * Returns a client key for an address: IPv4 as is, IPv4-mapped IPv6 as dotted IPv4, other IPv6 as
 * its /64 prefix (`2001:db8:0:1::/64`), and `unknown` for anything that is not an IP.
 */
export function clientKeyOf(address: string | undefined): string {
  if (address === undefined) return "unknown";
  const value = normalizeAddress(address);
  switch (isIP(value)) {
    case 4:
      return value;
    case 6: {
      const groups = expandIpv6(value.toLowerCase());
      const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
      if (isMapped) {
        const hi = groups[6] ?? 0;
        const lo = groups[7] ?? 0;
        return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
      }
      return `${groups
        .slice(0, 4)
        .map((g) => g.toString(16))
        .join(":")}::/64`;
    }
    default:
      return "unknown";
  }
}
