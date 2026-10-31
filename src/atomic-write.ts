import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { dirname } from "node:path";

export type AtomicWriteStage = "write" | "rename" | "sync-dir";

function errorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  // An own data property only, so no getter of the thrown value runs.
  let value: unknown;
  try {
    value = Object.getOwnPropertyDescriptor(err, "code")?.value;
  } catch {
    // A Proxy trap threw; treat the code as unknown so its text never escapes.
    return undefined;
  }
  return typeof value === "string" && /^E[A-Z0-9]+$/.test(value) ? value : undefined;
}

/** A failed atomic write. The message names only the stage and a Node error code. */
export class AtomicWriteError extends Error {
  readonly stage: AtomicWriteStage;
  /** Node error code of the cause when it matches /^E[A-Z0-9]+$/, else undefined. */
  readonly code: string | undefined;

  constructor(stage: AtomicWriteStage, cause: unknown) {
    const code = errorCode(cause);
    const suffix = code === undefined ? "" : ` (${code})`;
    super(`atomic write failed at ${stage}${suffix}`, { cause });
    this.name = "AtomicWriteError";
    this.stage = stage;
    this.code = code;
  }
}

interface FileStat {
  mode: number;
  uid: number;
  gid: number;
}

export interface AtomicWriteSyncFs {
  /** Throws an error with code ENOENT when `path` does not exist. */
  stat(path: string): FileStat;
  open(path: string, flags: "wx" | "r", mode?: number): number;
  /** Writes from `offset`; returns the number of bytes written. */
  write(fd: number, data: Uint8Array, offset: number): number;
  fchmod(fd: number, mode: number): void;
  fstat(fd: number): { uid: number; gid: number };
  fchown(fd: number, uid: number, gid: number): void;
  fsync(fd: number): void;
  close(fd: number): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
}

/** The same operations, each returning a Promise of the sync result. */
export type AtomicWriteFs = {
  [K in keyof AtomicWriteSyncFs]: (
    ...args: Parameters<AtomicWriteSyncFs[K]>
  ) => Promise<ReturnType<AtomicWriteSyncFs[K]>>;
};

export const nodeAtomicWriteSyncFs: AtomicWriteSyncFs = {
  stat: (path) => fs.statSync(path),
  open: (path, flags, mode) => fs.openSync(path, flags, mode),
  write: (fd, data, offset) => fs.writeSync(fd, data, offset, data.length - offset),
  fchmod: (fd, mode) => fs.fchmodSync(fd, mode),
  fstat: (fd) => fs.fstatSync(fd),
  fchown: (fd, uid, gid) => fs.fchownSync(fd, uid, gid),
  fsync: (fd) => fs.fsyncSync(fd),
  close: (fd) => fs.closeSync(fd),
  rename: (from, to) => fs.renameSync(from, to),
  unlink: (path) => fs.unlinkSync(path),
};

type Callback<T> = (err: NodeJS.ErrnoException | null, value: T) => void;

function call<T>(run: (cb: Callback<T>) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    run((err, value) => (err === null ? resolve(value) : reject(err)));
  });
}

function callVoid(run: (cb: (err: NodeJS.ErrnoException | null) => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    run((err) => (err === null ? resolve() : reject(err)));
  });
}

export const nodeAtomicWriteFs: AtomicWriteFs = {
  stat: (path) => call<fs.Stats>((cb) => fs.stat(path, cb)),
  open: (path, flags, mode) => call<number>((cb) => fs.open(path, flags, mode, cb)),
  write: (fd, data, offset) =>
    call<number>((cb) => fs.write(fd, data, offset, data.length - offset, null, cb)),
  fchmod: (fd, mode) => callVoid((cb) => fs.fchmod(fd, mode, cb)),
  fstat: (fd) => call<fs.Stats>((cb) => fs.fstat(fd, cb)),
  fchown: (fd, uid, gid) => callVoid((cb) => fs.fchown(fd, uid, gid, cb)),
  fsync: (fd) => callVoid((cb) => fs.fsync(fd, cb)),
  close: (fd) => callVoid((cb) => fs.close(fd, cb)),
  rename: (from, to) => callVoid((cb) => fs.rename(from, to, cb)),
  unlink: (path) => callVoid((cb) => fs.unlink(path, cb)),
};

export interface AtomicWriteOptions {
  /** Mode of a new file (the destination does not exist yet). Default 0o600. */
  mode?: number;
  /** Unique part of the temp name. Default `${process.pid}-${12 lowercase hex}`. */
  tempSuffix?: () => string;
}

interface Plan {
  existing: FileStat | undefined;
  mode: number;
  bytes: Uint8Array;
}

function defaultSuffix(): string {
  return `${process.pid}-${randomBytes(6).toString("hex")}`;
}

function planOf(
  existing: FileStat | undefined,
  data: string | Uint8Array,
  opts: AtomicWriteOptions,
): Plan {
  const mode = existing === undefined ? (opts.mode ?? 0o600) : existing.mode & 0o7777;
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return { existing, mode, bytes };
}

function tempPathOf(path: string, opts: AtomicWriteOptions): string {
  return `${path}.${(opts.tempSuffix ?? defaultSuffix)()}.tmp`;
}

function isEnoent(err: unknown): boolean {
  return errorCode(err) === "ENOENT";
}

function isEperm(err: unknown): boolean {
  return errorCode(err) === "EPERM";
}

function hasOtherOwner(plan: Plan, current: { uid: number; gid: number }): boolean {
  const { existing } = plan;
  return existing !== undefined && (current.uid !== existing.uid || current.gid !== existing.gid);
}

// --- sync ---

function statSync(f: AtomicWriteSyncFs, path: string): FileStat | undefined {
  try {
    return f.stat(path);
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw new AtomicWriteError("write", err);
  }
}

function unlinkQuietSync(f: AtomicWriteSyncFs, path: string): void {
  try {
    f.unlink(path);
  } catch {
    // Best effort: the original error is reported.
  }
}

function fillTempSync(f: AtomicWriteSyncFs, fd: number, plan: Plan): void {
  let offset = 0;
  while (offset < plan.bytes.length) offset += f.write(fd, plan.bytes, offset);
  f.fchmod(fd, plan.mode);
  const existing = plan.existing;
  if (existing !== undefined && hasOtherOwner(plan, f.fstat(fd))) {
    try {
      f.fchown(fd, existing.uid, existing.gid);
    } catch (err) {
      // Only a privileged process may change the owner; keep the file with ours.
      if (!isEperm(err)) throw err;
    }
  }
  f.fsync(fd);
}

function writeTempSync(f: AtomicWriteSyncFs, temp: string, fd: number, plan: Plan): void {
  try {
    try {
      fillTempSync(f, fd, plan);
    } catch (err) {
      try {
        f.close(fd);
      } catch {
        // Best effort: the original error is reported.
      }
      throw err;
    }
    f.close(fd);
  } catch (err) {
    unlinkQuietSync(f, temp);
    throw new AtomicWriteError("write", err);
  }
}

function syncDirSync(f: AtomicWriteSyncFs, path: string): void {
  try {
    const fd = f.open(dirname(path), "r");
    try {
      f.fsync(fd);
    } finally {
      f.close(fd);
    }
  } catch (err) {
    throw new AtomicWriteError("sync-dir", err);
  }
}

/**
 * Replaces `path` with `data` through a temp file in the same directory: write, fsync, rename,
 * directory fsync. Returns false when `beforeRename` returns false (the destination is untouched).
 */
export function writeFileAtomicSync(
  path: string,
  data: string | Uint8Array,
  opts: AtomicWriteOptions & { fs?: AtomicWriteSyncFs; beforeRename?: () => boolean } = {},
): boolean {
  const f = opts.fs ?? nodeAtomicWriteSyncFs;
  const plan = planOf(statSync(f, path), data, opts);
  let temp: string;
  let fd: number;
  try {
    temp = tempPathOf(path, opts);
    fd = f.open(temp, "wx", plan.mode);
  } catch (err) {
    // Nothing was created, so nothing is removed: the name may belong to another writer.
    throw new AtomicWriteError("write", err);
  }
  writeTempSync(f, temp, fd, plan);
  let isWanted: boolean;
  try {
    isWanted = opts.beforeRename?.() ?? true;
  } catch (err) {
    unlinkQuietSync(f, temp);
    throw err;
  }
  if (!isWanted) {
    unlinkQuietSync(f, temp);
    return false;
  }
  try {
    f.rename(temp, path);
  } catch (err) {
    unlinkQuietSync(f, temp);
    throw new AtomicWriteError("rename", err);
  }
  syncDirSync(f, path);
  return true;
}

// --- async ---

async function statAsync(f: AtomicWriteFs, path: string): Promise<FileStat | undefined> {
  try {
    return await f.stat(path);
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw new AtomicWriteError("write", err);
  }
}

async function unlinkQuiet(f: AtomicWriteFs, path: string): Promise<void> {
  try {
    await f.unlink(path);
  } catch {
    // Best effort: the original error is reported.
  }
}

async function fillTemp(f: AtomicWriteFs, fd: number, plan: Plan): Promise<void> {
  let offset = 0;
  while (offset < plan.bytes.length) offset += await f.write(fd, plan.bytes, offset);
  await f.fchmod(fd, plan.mode);
  const existing = plan.existing;
  if (existing !== undefined && hasOtherOwner(plan, await f.fstat(fd))) {
    try {
      await f.fchown(fd, existing.uid, existing.gid);
    } catch (err) {
      // Only a privileged process may change the owner; keep the file with ours.
      if (!isEperm(err)) throw err;
    }
  }
  await f.fsync(fd);
}

async function writeTemp(f: AtomicWriteFs, temp: string, fd: number, plan: Plan): Promise<void> {
  try {
    try {
      await fillTemp(f, fd, plan);
    } catch (err) {
      try {
        await f.close(fd);
      } catch {
        // Best effort: the original error is reported.
      }
      throw err;
    }
    await f.close(fd);
  } catch (err) {
    await unlinkQuiet(f, temp);
    throw new AtomicWriteError("write", err);
  }
}

async function syncDir(f: AtomicWriteFs, path: string): Promise<void> {
  try {
    const fd = await f.open(dirname(path), "r");
    try {
      await f.fsync(fd);
    } finally {
      await f.close(fd);
    }
  } catch (err) {
    throw new AtomicWriteError("sync-dir", err);
  }
}

/** The async form of `writeFileAtomicSync`, with the same steps in the same order. */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  opts: AtomicWriteOptions & {
    fs?: AtomicWriteFs;
    beforeRename?: () => boolean | Promise<boolean>;
  } = {},
): Promise<boolean> {
  const f = opts.fs ?? nodeAtomicWriteFs;
  const plan = planOf(await statAsync(f, path), data, opts);
  let temp: string;
  let fd: number;
  try {
    temp = tempPathOf(path, opts);
    fd = await f.open(temp, "wx", plan.mode);
  } catch (err) {
    // Nothing was created, so nothing is removed: the name may belong to another writer.
    throw new AtomicWriteError("write", err);
  }
  await writeTemp(f, temp, fd, plan);
  let isWanted: boolean;
  try {
    isWanted = (await opts.beforeRename?.()) ?? true;
  } catch (err) {
    await unlinkQuiet(f, temp);
    throw err;
  }
  if (!isWanted) {
    await unlinkQuiet(f, temp);
    return false;
  }
  try {
    await f.rename(temp, path);
  } catch (err) {
    await unlinkQuiet(f, temp);
    throw new AtomicWriteError("rename", err);
  }
  await syncDir(f, path);
  return true;
}
