import { test } from "bun:test";
import assert from "node:assert/strict";
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

test("formats by hand when the runtime has no Intl.DurationFormat", async () => {
  const original = Reflect.get(Intl, "DurationFormat");
  Reflect.deleteProperty(Intl, "DurationFormat");
  try {
    // A query string makes the runtime evaluate the module again without the formatter.
    const specifier = "../src/format-duration.ts?without-intl";
    const mod = (await import(specifier)) as { formatDuration(ms: number): string };
    assert.equal(mod.formatDuration(12 * MIN), "12m");
    assert.equal(mod.formatDuration((3 * 60 + 5) * MIN), "3h 5m");
    assert.equal(mod.formatDuration(3 * 60 * MIN), "3h");
    assert.equal(mod.formatDuration((26 * 60 + 7) * MIN), "1d 2h");
    assert.equal(mod.formatDuration(48 * 60 * MIN), "2d");
  } finally {
    Reflect.set(Intl, "DurationFormat", original);
  }
});
