import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { escapeHtml, escapeLabel } from "../src/escape.ts";

test("escapeHtml", () => {
  assert.equal(
    escapeHtml(`<a href="x">&'</a>`),
    "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
  );
});

test("escapeLabel escapes backslash, quote and newline", () => {
  assert.equal(escapeLabel('a\\b"c\nd'), 'a\\\\b\\"c\\nd');
});

test("browser-safe modules import nothing from node", () => {
  for (const file of ["escape", "format-duration"]) {
    const src = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /node:/, file);
    assert.doesNotMatch(src, /^import /m, file);
  }
});
