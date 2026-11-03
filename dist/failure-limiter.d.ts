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
export type FailureCheck = {
    isBlocked: false;
} | {
    isBlocked: true;
    retryAfterMs: number;
};
export interface FailureLimiter {
    check(key: string): FailureCheck;
    recordFailure(key: string): void;
}
/** Creates a limiter. Invalid options throw `RangeError`. Holds no timers. */
export declare function createFailureLimiter(options: FailureLimiterOptions): FailureLimiter;
/**
 * Returns a client key for an address: IPv4 as is, IPv4-mapped IPv6 as dotted IPv4, other IPv6 as
 * its /64 prefix (`2001:db8:0:1::/64`), and `unknown` for anything that is not an IP.
 */
export declare function clientKeyOf(address: string | undefined): string;
