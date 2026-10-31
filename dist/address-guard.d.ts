import { type AddressClassifier } from "./ip-classifier.ts";
/** A connection target is in a blocked category. The message holds no host or address. */
export declare class BlockedAddressError extends Error {
    name: string;
    readonly category: string;
    constructor(category: string);
}
/** Resolves a host name to all its addresses, in answer order. */
export type LookupAll = (host: string) => Promise<readonly string[]>;
/** The system resolver (`/etc/hosts` included) through `node:dns/promises` `lookup`. */
export declare const lookupAll: LookupAll;
export interface ResolveOptions {
    lookup: LookupAll;
    classify: AddressClassifier;
    signal?: AbortSignal | undefined;
}
/**
 * Returns the addresses of `host` when none of them is blocked. A mixed answer is blocked by
 * the first blocked address in answer order; a non-IP answer is `unrecognized`.
 */
export declare function resolveAllowed(host: string, { lookup: lookupImpl, classify, signal }: ResolveOptions): Promise<readonly string[]>;
/**
 * Tries `attempt` per address in order. It goes on only after a connection failure and while
 * the signal is not aborted, and rethrows the last error.
 */
export declare function connectFirst<T>(addresses: readonly string[], attempt: (address: string) => Promise<T>, signal?: AbortSignal): Promise<T>;
