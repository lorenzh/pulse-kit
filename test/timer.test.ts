import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TIMER_DELAY_MS, safeSetTimeout } from "../src/index.ts";

test("MAX_TIMER_DELAY_MS is 2^31 - 1", () => {
  assert.equal(MAX_TIMER_DELAY_MS, 2 ** 31 - 1);
});

test("safeSetTimeout passes a valid delay to the implementation", () => {
  const calls: number[] = [];
  const fake = ((_fn: () => void, ms: number) => {
    calls.push(ms);
    return 7;
  }) as unknown as typeof setTimeout;
  safeSetTimeout(() => {}, MAX_TIMER_DELAY_MS, fake);
  safeSetTimeout(() => {}, 0, fake);
  assert.deepEqual(calls, [MAX_TIMER_DELAY_MS, 0]);
});

test("safeSetTimeout rejects invalid delays", () => {
  for (const ms of [Number.NaN, -1, 1.5, MAX_TIMER_DELAY_MS + 1]) {
    assert.throws(() => safeSetTimeout(() => {}, ms), {
      name: "RangeError",
      message: "timer delay must be an integer from 0 to 2147483647 ms",
    });
  }
});
