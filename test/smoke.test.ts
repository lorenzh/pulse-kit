import { test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ALL_MODULES = [
  "index",
  "address-guard",
  "guarded-fetch",
  "ip-classifier",
  "escape",
  "format-duration",
  "http",
  "logger",
  "metrics",
  "ops-server",
  "run-service",
  "settings",
  "timer",
];

const root = new URL("..", import.meta.url).pathname;

test("dist matches a fresh build of src", () => {
  const out = mkdtempSync(join(tmpdir(), "kit-dist-"));
  try {
    const tsc = join(root, "node_modules", "typescript7", "bin", "tsc");
    execFileSync(
      process.execPath,
      [tsc, "-p", join(root, "tsconfig.build.json"), "--outDir", out],
      { cwd: root },
    );
    for (const file of ALL_MODULES.flatMap((n) => [`${n}.d.ts`, `${n}.js`])) {
      assert.equal(
        readFileSync(join(root, "dist", file), "utf8"),
        readFileSync(join(out, file), "utf8"),
        `dist/${file} is out of date; run bun run build`,
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("package entry exports the helpers", async () => {
  const mod = await import("@lorenzh/pulse-kit");
  const byName = (a: string, b: string): number => a.localeCompare(b);
  assert.deepEqual(
    Object.keys(mod).sort(byName),
    [
      "BlockedAddressError",
      "BodyError",
      "connectFirst",
      "createGuardedFetch",
      "createIpClassifier",
      "lookupAll",
      "resolveAllowed",
      "DURATION_BUCKETS_SECONDS",
      "LOG_LEVELS",
      "MAX_TIMER_DELAY_MS",
      "StartupError",
      "createLogger",
      "createRegistry",
      "escapeHtml",
      "escapeLabel",
      "formatDuration",
      "handleOps",
      "readBody",
      "readBool",
      "readEnum",
      "readJsonBody",
      "readLogLevel",
      "readMs",
      "readPort",
      "readString",
      "readUrl",
      "runService",
      "safeSetTimeout",
      "sendJson",
      "startOpsServer",
    ].sort(byName),
  );
});

test("browser-safe subpaths resolve", async () => {
  const fd = await import("@lorenzh/pulse-kit/format-duration");
  const esc = await import("@lorenzh/pulse-kit/escape");
  assert.equal(fd.formatDuration(0), "<1m");
  assert.equal(esc.escapeLabel('"'), '\\"');
});
