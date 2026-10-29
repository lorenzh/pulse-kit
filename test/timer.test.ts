import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_TIMER_DELAY_MS } from "../src/index.ts";

test("MAX_TIMER_DELAY_MS is 2^31 - 1", () => {
  assert.equal(MAX_TIMER_DELAY_MS, 2 ** 31 - 1);
});
