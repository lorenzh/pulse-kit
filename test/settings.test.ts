import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  readBool,
  readEnum,
  readInt,
  readMs,
  readPort,
  readString,
  readUrl,
  StartupError,
} from "../src/settings.ts";

function messageOf(fn: () => unknown): { message: string; setting: string | undefined } {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof StartupError);
    assert.equal(err.name, "StartupError");
    return { message: err.message, setting: err.setting };
  }
  throw new Error("expected a StartupError");
}

test("StartupError keeps setting and cause", () => {
  const cause = new Error("x");
  const err = new StartupError("m", { setting: "A", cause });
  assert.equal(err.setting, "A");
  assert.equal(err.cause, cause);
});

test("readString trims and treats blank as unset", () => {
  assert.equal(readString({ A: " x " }, "A"), "x");
  assert.equal(readString({ A: "  " }, "A"), undefined);
  assert.equal(readString({}, "A"), undefined);
});

test("readMs reads, defaults and rejects without echoing the value", () => {
  const o = { fallback: 5000, min: 1000 };
  assert.equal(readMs({}, "A", o), 5000);
  assert.equal(readMs({ A: "" }, "A", o), 5000);
  assert.equal(readMs({ A: "2500" }, "A", o), 2500);
  const bad = messageOf(() => readMs({ A: "12abc" }, "A", o));
  assert.equal(bad.message, "A: must be an integer from 1000 to 2147483647");
  assert.equal(bad.setting, "A");
  assert.equal(
    messageOf(() => readMs({ A: "999" }, "A", o)).message,
    "A: must be an integer from 1000 to 2147483647",
  );
  assert.equal(
    messageOf(() => readMs({ A: "11" }, "A", { fallback: 5, min: 1, max: 10 })).message,
    "A: must be an integer from 1 to 10",
  );
  assert.equal(
    messageOf(() => readMs({ A: "x" }, "A", { ...o, describe: "custom" })).message,
    "A: custom",
  );
});

test("readMs rejects values above the timer max and accepts the max", () => {
  const o = { fallback: 1, min: 0 };
  const scheduled: number[] = [];
  const fakeSetTimeout = (ms: number): void => {
    scheduled.push(ms);
  };
  for (const raw of ["2592000000", "2147483648"]) {
    const err = messageOf(() => fakeSetTimeout(readMs({ X: raw }, "X", o)));
    assert.equal(err.message, "X: must be an integer from 0 to 2147483647");
    assert.equal(err.setting, "X");
    assert.ok(!err.message.includes(raw));
  }
  assert.deepEqual(scheduled, []);
  assert.equal(readMs({ X: "2147483647" }, "X", o), 2147483647);
  assert.equal(
    messageOf(() => readMs({ X: "-1" }, "X", o)).message,
    "X: must be an integer from 0 to 2147483647",
  );
  for (const raw of ["1e3", "5000ms"])
    assert.throws(() => readMs({ X: raw }, "X", o), StartupError);
  assert.equal(readMs({ X: " " }, "X", o), 1);
});

test("readMs throws RangeError for a bad max or fallback, even when unset", () => {
  assert.throws(() => readMs({}, "X", { fallback: 5000, min: 0, max: 3_000_000_000 }), {
    name: "RangeError",
    message: "readMs(X): max must be an integer of at most 2147483647",
  });
  assert.throws(() => readMs({}, "X", { fallback: 2_592_000_000, min: 0, max: Number.NaN }), {
    name: "RangeError",
    message: "readMs(X): max must be an integer of at most 2147483647",
  });
  assert.throws(() => readMs({}, "X", { fallback: 1, min: Number.NaN }), {
    name: "RangeError",
    message: "readMs(X): min must be an integer",
  });
  assert.throws(() => readMs({}, "X", { fallback: 0, min: 1 }), {
    name: "RangeError",
    message: "readMs(X): fallback must be an integer from 1 to 2147483647",
  });
  assert.throws(() => readMs({}, "X", { fallback: 1.5, min: 0, max: 10 }), {
    name: "RangeError",
    message: "readMs(X): fallback must be an integer from 0 to 10",
  });
});

test("readInt keeps the safe-integer range and the >= rule", () => {
  const o = { fallback: 1, min: 0 };
  assert.equal(readInt({ X: "3000000000" }, "X", o), 3000000000);
  assert.equal(readInt({}, "X", o), 1);
  assert.equal(
    messageOf(() => readInt({ X: "89" }, "X", { fallback: 90, min: 90 })).message,
    "X: must be an integer >= 90",
  );
  assert.equal(
    messageOf(() => readInt({ X: "11" }, "X", { fallback: 5, min: 1, max: 10 })).message,
    "X: must be an integer from 1 to 10",
  );
  assert.equal(messageOf(() => readInt({ X: "y" }, "X", { ...o, describe: "c" })).message, "X: c");
});

test("readPort", () => {
  assert.equal(readPort({}, "P"), undefined);
  assert.equal(readPort({}, "P", { fallback: 80 }), 80);
  assert.equal(readPort({ P: "0" }, "P"), 0);
  assert.equal(readPort({ P: "65535" }, "P"), 65535);
  assert.equal(
    messageOf(() => readPort({ P: "65536" }, "P")).message,
    "P: must be an integer from 0 to 65535",
  );
  assert.throws(() => readPort({ P: "0" }, "P", { min: 1 }), StartupError);
});

test("readUrl", () => {
  assert.equal(readUrl({}, "U"), undefined);
  assert.equal(readUrl({ U: "http://a.example:8080/" }, "U"), "http://a.example:8080");
  assert.equal(readUrl({ U: "http://a.example/p/" }, "U"), "http://a.example/p");
  const rule = "U: must be an http(s) URL without credentials, query or fragment";
  for (const v of [
    "ftp://a.example",
    "nope",
    "http://u:p@a.example",
    "http://a.example/?q=1",
    "http://a.example/#f",
  ]) {
    assert.equal(messageOf(() => readUrl({ U: v }, "U")).message, rule, v);
  }
  assert.equal(
    readUrl({ U: "http://a.example/?q=1" }, "U", { allowQueryOrFragment: true }),
    "http://a.example/?q=1",
  );
  assert.equal(
    readUrl({ U: "http://u:p@a.example" }, "U", { allowCredentials: true }),
    "http://u:p@a.example",
  );
  assert.equal(readUrl({ U: "ws://a.example" }, "U", { protocols: ["ws:"] }), "ws://a.example");
});

test("readEnum and readBool", () => {
  assert.equal(readEnum({}, "E", ["a", "b"], "a"), "a");
  assert.equal(readEnum({ E: "b" }, "E", ["a", "b"], "a"), "b");
  assert.equal(
    messageOf(() => readEnum({ E: "c" }, "E", ["a", "b"], "a")).message,
    "E: must be one of a, b",
  );
  assert.equal(readBool({}, "B", true), true);
  assert.equal(readBool({ B: "1" }, "B", false), true);
  assert.equal(readBool({ B: "false" }, "B", true), false);
  assert.equal(
    messageOf(() => readBool({ B: "yes" }, "B", false)).message,
    "B: must be true, false, 1 or 0",
  );
});
