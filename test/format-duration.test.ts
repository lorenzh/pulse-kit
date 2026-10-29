import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration } from "../src/format-duration.ts";

const MIN = 60_000;

test("formats whole minutes in at most two units", () => {
  const cases: [number, string][] = [
    [0, "<1m"],
    [59_999, "<1m"],
    [-5, "<1m"],
    [Number.NaN, "<1m"],
    [12 * MIN, "12m"],
    [(3 * 60 + 5) * MIN, "3h 5m"],
    [3 * 60 * MIN, "3h"],
    [(26 * 60 + 7) * MIN, "1d 2h"],
    [48 * 60 * MIN, "2d"],
  ];
  for (const [ms, text] of cases) assert.equal(formatDuration(ms), text);
});
