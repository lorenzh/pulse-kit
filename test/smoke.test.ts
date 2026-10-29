import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;

test("dist matches a fresh build of src", () => {
  const out = mkdtempSync(join(tmpdir(), "kit-dist-"));
  try {
    const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
    execFileSync(
      process.execPath,
      [tsc, "-p", join(root, "tsconfig.build.json"), "--outDir", out],
      { cwd: root },
    );
    for (const file of ["index"].flatMap((n) => [`${n}.d.ts`, `${n}.js`])) {
      assert.equal(
        readFileSync(join(root, "dist", file), "utf8"),
        readFileSync(join(out, file), "utf8"),
        `dist/${file} is out of date; run npm run build`,
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("package entry exports the helpers", async () => {
  const mod = await import("@lorenzh/pulse-kit");
  const byName = (a: string, b: string): number => a.localeCompare(b);
  assert.deepEqual(Object.keys(mod).sort(byName), ["MAX_TIMER_DELAY_MS"].sort(byName));
});
