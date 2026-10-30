import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  readBool,
  readEnum,
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
  assert.equal(bad.message, "A: must be an integer >= 1000");
  assert.equal(bad.setting, "A");
  assert.equal(
    messageOf(() => readMs({ A: "999" }, "A", o)).message,
    "A: must be an integer >= 1000",
  );
  assert.equal(
    messageOf(() => readMs({ A: "11" }, "A", { ...o, min: 1, max: 10 })).message,
    "A: must be an integer from 1 to 10",
  );
  assert.equal(
    messageOf(() => readMs({ A: "x" }, "A", { ...o, describe: "custom" })).message,
    "A: custom",
  );
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
