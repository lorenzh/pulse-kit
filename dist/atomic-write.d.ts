export type AtomicWriteStage = "write" | "rename" | "sync-dir";
/** A failed atomic write. The message names only the stage and a Node error code. */
export declare class AtomicWriteError extends Error {
    readonly stage: AtomicWriteStage;
    /** Node error code of the cause when it matches /^E[A-Z0-9]+$/, else undefined. */
    readonly code: string | undefined;
    constructor(stage: AtomicWriteStage, cause: unknown);
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
    fstat(fd: number): {
        uid: number;
        gid: number;
    };
    fchown(fd: number, uid: number, gid: number): void;
    fsync(fd: number): void;
    close(fd: number): void;
    rename(from: string, to: string): void;
    unlink(path: string): void;
}
/** The same operations, each returning a Promise of the sync result. */
export type AtomicWriteFs = {
    [K in keyof AtomicWriteSyncFs]: (...args: Parameters<AtomicWriteSyncFs[K]>) => Promise<ReturnType<AtomicWriteSyncFs[K]>>;
};
export declare const nodeAtomicWriteSyncFs: AtomicWriteSyncFs;
export declare const nodeAtomicWriteFs: AtomicWriteFs;
export interface AtomicWriteOptions {
    /** Mode of a new file (the destination does not exist yet). Default 0o600. */
    mode?: number;
    /** Unique part of the temp name. Default `${process.pid}-${12 lowercase hex}`. */
    tempSuffix?: () => string;
}
/**
 * Replaces `path` with `data` through a temp file in the same directory: write, fsync, rename,
 * directory fsync. Returns false when `beforeRename` returns false (the destination is untouched).
 */
export declare function writeFileAtomicSync(path: string, data: string | Uint8Array, opts?: AtomicWriteOptions & {
    fs?: AtomicWriteSyncFs;
    beforeRename?: () => boolean;
}): boolean;
/** The async form of `writeFileAtomicSync`, with the same steps in the same order. */
export declare function writeFileAtomic(path: string, data: string | Uint8Array, opts?: AtomicWriteOptions & {
    fs?: AtomicWriteFs;
    beforeRename?: () => boolean | Promise<boolean>;
}): Promise<boolean>;
export {};
