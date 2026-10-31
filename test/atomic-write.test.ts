import { afterEach, beforeEach, describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  AtomicWriteError,
  type AtomicWriteFs,
  type AtomicWriteSyncFs,
  nodeAtomicWriteFs,
  nodeAtomicWriteSyncFs,
  writeFileAtomic,
  writeFileAtomicSync,
} from "../src/atomic-write.ts";

/** Returns an error to throw for this call, or undefined to delegate. */
type FailOn = (label: string, args: readonly unknown[]) => unknown;

interface Recorder {
  calls: string[];
  args: { label: string; args: readonly unknown[] }[];
  syncFs: AtomicWriteSyncFs;
  asyncFs: AtomicWriteFs;
}

const OPS = [
  "stat",
  "open",
  "write",
  "fchmod",
  "fstat",
  "fchown",
  "fsync",
  "close",
  "rename",
  "unlink",
] as const;

function recorder(failOn: FailOn = () => undefined): Recorder {
  const calls: string[] = [];
  const args: Recorder["args"] = [];
  let dirFd: number | undefined;
  const before = (op: string, a: readonly unknown[]): void => {
    const label = op === "open" ? `open(${String(a[1])})` : op;
    calls.push(label);
    args.push({ label, args: a });
    const detail = op === "fsync" && a[0] === dirFd ? "fsync(dir)" : label;
    const err = failOn(detail, a);
    if (err !== undefined) throw err;
  };
  const after = (op: string, a: readonly unknown[], result: unknown): void => {
    if (op === "open" && a[1] === "r" && typeof result === "number") dirFd = result;
  };
  const syncFs: Record<string, unknown> = {};
  const asyncFs: Record<string, unknown> = {};
  for (const op of OPS) {
    syncFs[op] = (...a: unknown[]): unknown => {
      before(op, a);
      const result: unknown = (nodeAtomicWriteSyncFs[op] as (...x: unknown[]) => unknown)(...a);
      after(op, a, result);
      return result;
    };
    asyncFs[op] = async (...a: unknown[]): Promise<unknown> => {
      before(op, a);
      const result: unknown = await (
        nodeAtomicWriteFs[op] as (...x: unknown[]) => Promise<unknown>
      )(...a);
      after(op, a, result);
      return result;
    };
  }
  return {
    calls,
    args,
    syncFs: syncFs as unknown as AtomicWriteSyncFs,
    asyncFs: asyncFs as unknown as AtomicWriteFs,
  };
}

interface RunOpts {
  mode?: number;
  tempSuffix?: () => string;
  beforeRename?: () => boolean;
}

type Run = (path: string, data: string, rec: Recorder, opts?: RunOpts) => Promise<boolean>;

const KINDS: [string, Run][] = [
  [
    "writeFileAtomicSync",
    async (path, data, rec, opts = {}) =>
      writeFileAtomicSync(path, data, { ...opts, fs: rec.syncFs }),
  ],
  [
    "writeFileAtomic",
    (path, data, rec, opts = {}) => writeFileAtomic(path, data, { ...opts, fs: rec.asyncFs }),
  ],
];

const MESSAGE = /^atomic write failed at (write|rename|sync-dir)( \(E[A-Z0-9]+\))?$/;

async function failure(promise: Promise<unknown>, path: string): Promise<AtomicWriteError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof AtomicWriteError);
    assert.equal(err.name, "AtomicWriteError");
    assert.match(err.message, MESSAGE);
    assert.ok(!err.message.includes(path));
    assert.ok(!err.message.includes("new"));
    return err;
  }
  throw new Error("expected an AtomicWriteError");
}

function code(c: string): Error {
  return Object.assign(new Error("injected"), { code: c });
}

function temps(dir: string): string[] {
  return readdirSync(dir).filter((n) => n.endsWith(".tmp"));
}

for (const [name, run] of KINDS) {
  describe(name, () => {
    let dir = "";
    let file = "";
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "kit-atomic-"));
      file = join(dir, "data.json");
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test("writes, fsyncs, renames and fsyncs the directory in order", async () => {
      const rec = recorder();
      assert.equal(await run(file, "new\n", rec), true);
      assert.deepEqual(rec.calls, [
        "stat",
        "open(wx)",
        "write",
        "fchmod",
        "fsync",
        "close",
        "rename",
        "open(r)",
        "fsync",
        "close",
      ]);
      assert.equal(readFileSync(file, "utf8"), "new\n");
      assert.equal(statSync(file).mode & 0o777, 0o600);
      const open = rec.args.find((c) => c.label === "open(wx)");
      const temp = String(open?.args[0]);
      assert.equal(dirname(temp), dir);
      assert.ok(temp.endsWith(".tmp"));
      assert.deepEqual(temps(dir), []);
    });

    test("an existing file adds fstat and keeps its mode", async () => {
      writeFileSync(file, "old\n");
      chmodSync(file, 0o640);
      const rec = recorder();
      assert.equal(await run(file, "new\n", rec), true);
      assert.deepEqual(rec.calls, [
        "stat",
        "open(wx)",
        "write",
        "fchmod",
        "fstat",
        "fsync",
        "close",
        "rename",
        "open(r)",
        "fsync",
        "close",
      ]);
      assert.equal(statSync(file).mode & 0o777, 0o640);
      assert.equal(readFileSync(file, "utf8"), "new\n");
    });

    test("mode applies to a new file", async () => {
      await run(file, "new\n", recorder(), { mode: 0o640 });
      assert.equal(statSync(file).mode & 0o777, 0o640);
    });

    test("ENOSPC on the temp fsync keeps the old bytes and no temp", async () => {
      writeFileSync(file, "old\n");
      const rec = recorder((label) => (label === "fsync" ? code("ENOSPC") : undefined));
      const err = await failure(run(file, "new\n", rec), file);
      assert.equal(err.stage, "write");
      assert.equal(err.code, "ENOSPC");
      assert.equal(err.message, "atomic write failed at write (ENOSPC)");
      assert.equal(readFileSync(file, "utf8"), "old\n");
      assert.deepEqual(temps(dir), []);
      assert.equal(await run(file, "new\n", recorder()), true);
      assert.equal(readFileSync(file, "utf8"), "new\n");
    });

    test("an interrupted first write leaves no file", async () => {
      const rec = recorder((label) => (label === "write" ? code("EIO") : undefined));
      const err = await failure(run(file, "new\n", rec), file);
      assert.equal(err.stage, "write");
      assert.deepEqual(readdirSync(dir), []);
    });

    test("beforeRename false keeps the old file", async () => {
      writeFileSync(file, "old\n");
      assert.equal(await run(file, "new\n", recorder(), { beforeRename: () => false }), false);
      assert.equal(readFileSync(file, "utf8"), "old\n");
      assert.deepEqual(temps(dir), []);
    });

    test("beforeRename throwing rethrows the same error", async () => {
      writeFileSync(file, "old\n");
      const own = new Error("stale");
      await assert.rejects(
        run(file, "new\n", recorder(), {
          beforeRename: () => {
            throw own;
          },
        }),
        (err) => {
          assert.strictEqual(err, own);
          return true;
        },
      );
      assert.equal(readFileSync(file, "utf8"), "old\n");
      assert.deepEqual(temps(dir), []);
    });

    test("EXDEV on rename keeps the old file", async () => {
      writeFileSync(file, "old\n");
      const rec = recorder((label) => (label === "rename" ? code("EXDEV") : undefined));
      const err = await failure(run(file, "new\n", rec), file);
      assert.equal(err.stage, "rename");
      assert.equal(err.code, "EXDEV");
      assert.equal(readFileSync(file, "utf8"), "old\n");
      assert.deepEqual(temps(dir), []);
    });

    test("a failed directory fsync reports sync-dir with the new bytes in place", async () => {
      writeFileSync(file, "old\n");
      const rec = recorder((label) => (label === "fsync(dir)" ? code("EIO") : undefined));
      const err = await failure(run(file, "new\n", rec), file);
      assert.equal(err.stage, "sync-dir");
      assert.equal(err.message, "atomic write failed at sync-dir (EIO)");
      assert.equal(readFileSync(file, "utf8"), "new\n");
    });

    test("a temp name collision fails without removing the foreign file", async () => {
      writeFileSync(file, "old\n");
      writeFileSync(`${file}.x.tmp`, "foreign");
      const rec = recorder();
      const err = await failure(run(file, "new\n", rec, { tempSuffix: () => "x" }), file);
      assert.equal(err.stage, "write");
      assert.equal(err.code, "EEXIST");
      assert.equal(readFileSync(`${file}.x.tmp`, "utf8"), "foreign");
      assert.equal(readFileSync(file, "utf8"), "old\n");
      assert.ok(!rec.calls.includes("unlink"));
    });

    test("an error without a code has no suffix", async () => {
      const rec = recorder((label) => (label === "stat" ? new Error("secret") : undefined));
      const err = await failure(run(file, "new\n", rec), file);
      assert.equal(err.message, "atomic write failed at write");
      assert.equal(err.code, undefined);
    });
  });
}
