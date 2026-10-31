import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { dirname } from "node:path";
function errorCode(err) {
    if (typeof err !== "object" || err === null)
        return undefined;
    // An own data property only, so no getter of the thrown value runs.
    let value;
    try {
        value = Object.getOwnPropertyDescriptor(err, "code")?.value;
    }
    catch {
        // A Proxy trap threw; treat the code as unknown so its text never escapes.
        return undefined;
    }
    return typeof value === "string" && /^E[A-Z0-9]+$/.test(value) ? value : undefined;
}
/** A failed atomic write. The message names only the stage and a Node error code. */
export class AtomicWriteError extends Error {
    stage;
    /** Node error code of the cause when it matches /^E[A-Z0-9]+$/, else undefined. */
    code;
    constructor(stage, cause) {
        const code = errorCode(cause);
        const suffix = code === undefined ? "" : ` (${code})`;
        super(`atomic write failed at ${stage}${suffix}`, { cause });
        this.name = "AtomicWriteError";
        this.stage = stage;
        this.code = code;
    }
}
export const nodeAtomicWriteSyncFs = {
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
function call(run) {
    return new Promise((resolve, reject) => {
        run((err, value) => (err === null ? resolve(value) : reject(err)));
    });
}
function callVoid(run) {
    return new Promise((resolve, reject) => {
        run((err) => (err === null ? resolve() : reject(err)));
    });
}
export const nodeAtomicWriteFs = {
    stat: (path) => call((cb) => fs.stat(path, cb)),
    open: (path, flags, mode) => call((cb) => fs.open(path, flags, mode, cb)),
    write: (fd, data, offset) => call((cb) => fs.write(fd, data, offset, data.length - offset, null, cb)),
    fchmod: (fd, mode) => callVoid((cb) => fs.fchmod(fd, mode, cb)),
    fstat: (fd) => call((cb) => fs.fstat(fd, cb)),
    fchown: (fd, uid, gid) => callVoid((cb) => fs.fchown(fd, uid, gid, cb)),
    fsync: (fd) => callVoid((cb) => fs.fsync(fd, cb)),
    close: (fd) => callVoid((cb) => fs.close(fd, cb)),
    rename: (from, to) => callVoid((cb) => fs.rename(from, to, cb)),
    unlink: (path) => callVoid((cb) => fs.unlink(path, cb)),
};
function defaultSuffix() {
    return `${process.pid}-${randomBytes(6).toString("hex")}`;
}
function planOf(existing, data, opts) {
    const mode = existing === undefined ? (opts.mode ?? 0o600) : existing.mode & 0o7777;
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    return { existing, mode, bytes };
}
function tempPathOf(path, opts) {
    return `${path}.${(opts.tempSuffix ?? defaultSuffix)()}.tmp`;
}
function isEnoent(err) {
    return errorCode(err) === "ENOENT";
}
function isEperm(err) {
    return errorCode(err) === "EPERM";
}
function hasOtherOwner(plan, current) {
    const { existing } = plan;
    return existing !== undefined && (current.uid !== existing.uid || current.gid !== existing.gid);
}
// --- sync ---
function statSync(f, path) {
    try {
        return f.stat(path);
    }
    catch (err) {
        if (isEnoent(err))
            return undefined;
        throw new AtomicWriteError("write", err);
    }
}
function unlinkQuietSync(f, path) {
    try {
        f.unlink(path);
    }
    catch {
        // Best effort: the original error is reported.
    }
}
function fillTempSync(f, fd, plan) {
    let offset = 0;
    while (offset < plan.bytes.length)
        offset += f.write(fd, plan.bytes, offset);
    f.fchmod(fd, plan.mode);
    const existing = plan.existing;
    if (existing !== undefined && hasOtherOwner(plan, f.fstat(fd))) {
        try {
            f.fchown(fd, existing.uid, existing.gid);
        }
        catch (err) {
            // Only a privileged process may change the owner; keep the file with ours.
            if (!isEperm(err))
                throw err;
        }
    }
    f.fsync(fd);
}
function writeTempSync(f, temp, fd, plan) {
    try {
        try {
            fillTempSync(f, fd, plan);
        }
        catch (err) {
            try {
                f.close(fd);
            }
            catch {
                // Best effort: the original error is reported.
            }
            throw err;
        }
        f.close(fd);
    }
    catch (err) {
        unlinkQuietSync(f, temp);
        throw new AtomicWriteError("write", err);
    }
}
function syncDirSync(f, path) {
    try {
        const fd = f.open(dirname(path), "r");
        try {
            f.fsync(fd);
        }
        finally {
            f.close(fd);
        }
    }
    catch (err) {
        throw new AtomicWriteError("sync-dir", err);
    }
}
/**
 * Replaces `path` with `data` through a temp file in the same directory: write, fsync, rename,
 * directory fsync. Returns false when `beforeRename` returns false (the destination is untouched).
 */
export function writeFileAtomicSync(path, data, opts = {}) {
    const f = opts.fs ?? nodeAtomicWriteSyncFs;
    const plan = planOf(statSync(f, path), data, opts);
    let temp;
    let fd;
    try {
        temp = tempPathOf(path, opts);
        fd = f.open(temp, "wx", plan.mode);
    }
    catch (err) {
        // Nothing was created, so nothing is removed: the name may belong to another writer.
        throw new AtomicWriteError("write", err);
    }
    writeTempSync(f, temp, fd, plan);
    let isWanted;
    try {
        isWanted = opts.beforeRename?.() ?? true;
    }
    catch (err) {
        unlinkQuietSync(f, temp);
        throw err;
    }
    if (!isWanted) {
        unlinkQuietSync(f, temp);
        return false;
    }
    try {
        f.rename(temp, path);
    }
    catch (err) {
        unlinkQuietSync(f, temp);
        throw new AtomicWriteError("rename", err);
    }
    syncDirSync(f, path);
    return true;
}
// --- async ---
async function statAsync(f, path) {
    try {
        return await f.stat(path);
    }
    catch (err) {
        if (isEnoent(err))
            return undefined;
        throw new AtomicWriteError("write", err);
    }
}
async function unlinkQuiet(f, path) {
    try {
        await f.unlink(path);
    }
    catch {
        // Best effort: the original error is reported.
    }
}
async function fillTemp(f, fd, plan) {
    let offset = 0;
    while (offset < plan.bytes.length)
        offset += await f.write(fd, plan.bytes, offset);
    await f.fchmod(fd, plan.mode);
    const existing = plan.existing;
    if (existing !== undefined && hasOtherOwner(plan, await f.fstat(fd))) {
        try {
            await f.fchown(fd, existing.uid, existing.gid);
        }
        catch (err) {
            // Only a privileged process may change the owner; keep the file with ours.
            if (!isEperm(err))
                throw err;
        }
    }
    await f.fsync(fd);
}
async function writeTemp(f, temp, fd, plan) {
    try {
        try {
            await fillTemp(f, fd, plan);
        }
        catch (err) {
            try {
                await f.close(fd);
            }
            catch {
                // Best effort: the original error is reported.
            }
            throw err;
        }
        await f.close(fd);
    }
    catch (err) {
        await unlinkQuiet(f, temp);
        throw new AtomicWriteError("write", err);
    }
}
async function syncDir(f, path) {
    try {
        const fd = await f.open(dirname(path), "r");
        try {
            await f.fsync(fd);
        }
        finally {
            await f.close(fd);
        }
    }
    catch (err) {
        throw new AtomicWriteError("sync-dir", err);
    }
}
/** The async form of `writeFileAtomicSync`, with the same steps in the same order. */
export async function writeFileAtomic(path, data, opts = {}) {
    const f = opts.fs ?? nodeAtomicWriteFs;
    const plan = planOf(await statAsync(f, path), data, opts);
    let temp;
    let fd;
    try {
        temp = tempPathOf(path, opts);
        fd = await f.open(temp, "wx", plan.mode);
    }
    catch (err) {
        // Nothing was created, so nothing is removed: the name may belong to another writer.
        throw new AtomicWriteError("write", err);
    }
    await writeTemp(f, temp, fd, plan);
    let isWanted;
    try {
        isWanted = (await opts.beforeRename?.()) ?? true;
    }
    catch (err) {
        await unlinkQuiet(f, temp);
        throw err;
    }
    if (!isWanted) {
        await unlinkQuiet(f, temp);
        return false;
    }
    try {
        await f.rename(temp, path);
    }
    catch (err) {
        await unlinkQuiet(f, temp);
        throw new AtomicWriteError("rename", err);
    }
    await syncDir(f, path);
    return true;
}
