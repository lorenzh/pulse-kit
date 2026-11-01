import { test } from "bun:test";
import assert from "node:assert/strict";
import { isRecord } from "../src/is-record.ts";

test("isRecord keeps the plain object predicate", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord(Object.create(null)), true);
  assert.equal(isRecord(new Date()), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord("x"), false);
  assert.equal(isRecord(1), false);
});
