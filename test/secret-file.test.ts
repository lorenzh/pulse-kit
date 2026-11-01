import { test } from "bun:test";
import assert from "node:assert/strict";
import { readSecretFile } from "../src/secret-file.ts";
import { StartupError } from "../src/settings.ts";

function fails(content: string): StartupError {
  try {
    readSecretFile("/run/s", { setting: "S", readFile: () => content });
  } catch (err) {
    assert.ok(err instanceof StartupError);
    return err;
  }
  throw new Error("expected a StartupError");
}

function readError(thrown: unknown): StartupError {
  try {
    readSecretFile("/run/s", {
      setting: "S",
      readFile: () => {
        throw thrown;
      },
    });
  } catch (err) {
    assert.ok(err instanceof StartupError);
    return err;
  }
  throw new Error("expected a StartupError");
}

test("readSecretFile returns the trimmed line", () => {
  let seen = "";
  const value = readSecretFile("/run/s", {
    setting: "S",
    readFile: (p) => {
      seen = p;
      return "  tok\n";
    },
  });
  assert.equal(value, "tok");
  assert.equal(seen, "/run/s");
});

test("readSecretFile rejects empty and multi-line content", () => {
  const empty = fails(" \n\n");
  assert.equal(empty.message, "S=/run/s: file is empty");
  assert.equal(empty.setting, "S");
  assert.equal(fails("a\nb").message, "S=/run/s: must hold one line");
  assert.equal(fails("a\r\nb").message, "S=/run/s: must hold one line");
  assert.ok(!fails("a\nsecret-sentinel").message.includes("secret-sentinel"));
});

test("readSecretFile reports a read error by code only", () => {
  const thrown = Object.assign(new Error("secret-sentinel"), { code: "ENOENT" });
  const err = readError(thrown);
  assert.equal(err.message, "S=/run/s: cannot read (ENOENT)");
  assert.equal(err.setting, "S");
  assert.equal(err.cause, thrown);
  assert.equal(readError({ code: "not a code" }).message, "S=/run/s: cannot read");
  assert.equal(readError("boom").message, "S=/run/s: cannot read");
});

test("readSecretFile sanitizes a cause whose property trap throws", () => {
  const cause = new Proxy(
    {},
    {
      getOwnPropertyDescriptor(): never {
        throw new Error("secret-sentinel");
      },
    },
  );
  const readFile = (): string => {
    throw cause;
  };
  assert.throws(() => readSecretFile("/run/s", { setting: "S", readFile }), {
    name: "StartupError",
    message: "S=/run/s: cannot read",
  });
});
