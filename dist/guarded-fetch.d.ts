/**
 * A fetch that connects only to resolved and allowed addresses. It needs Bun: it relies on
 * Bun's `tls.serverName` fetch option.
 */
import { type LookupAll } from "./address-guard.ts";
import type { AddressClassifier } from "./ip-classifier.ts";
export type GuardedFetch = (input: string | URL | Request, init?: BunFetchRequestInit) => Promise<Response>;
export interface GuardedFetchOptions {
    fetch: (input: string, init: BunFetchRequestInit) => Promise<Response>;
    lookup: LookupAll;
    classify: AddressClassifier;
}
/** Wraps `fetch` so every call resolves the host, checks every address and connects to one. */
export declare function createGuardedFetch({ fetch, lookup, classify }: GuardedFetchOptions): GuardedFetch;
