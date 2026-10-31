import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizeAddress } from "./ip-classifier.js";
/** A connection target is in a blocked category. The message holds no host or address. */
export class BlockedAddressError extends Error {
    name = "BlockedAddressError";
    category;
    constructor(category) {
        super(`blocked ${category} address`);
        this.category = category;
    }
}
/** The system resolver (`/etc/hosts` included) through `node:dns/promises` `lookup`. */
export const lookupAll = async (host) => {
    const answers = await lookup(host, { all: true });
    return answers.map((answer) => answer.address);
};
function raceSignal(promise, signal) {
    if (signal === undefined)
        return promise;
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
        }, (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
        });
    });
}
function notFound() {
    return Object.assign(new Error("no address found"), { code: "ENOTFOUND" });
}
/**
 * Returns the addresses of `host` when none of them is blocked. A mixed answer is blocked by
 * the first blocked address in answer order; a non-IP answer is `unrecognized`.
 */
export async function resolveAllowed(host, { lookup: lookupImpl, classify, signal }) {
    signal?.throwIfAborted();
    const literal = normalizeAddress(host);
    const addresses = isIP(literal) === 0 ? await raceSignal(lookupImpl(host), signal) : [literal];
    if (addresses.length === 0)
        throw notFound();
    const allowed = [];
    for (const raw of addresses) {
        const address = normalizeAddress(raw);
        if (isIP(address) === 0)
            throw new BlockedAddressError("unrecognized");
        const category = classify(address);
        if (category !== null)
            throw new BlockedAddressError(category);
        allowed.push(address);
    }
    return allowed;
}
/** No request was sent for these codes, so the next address may be tried. */
const FALLBACK_CODES = new Set([
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EADDRNOTAVAIL",
    "ConnectionRefused",
]);
function readCode(value) {
    if (typeof value !== "object" || value === null || !("code" in value))
        return undefined;
    return typeof value.code === "string" ? value.code : undefined;
}
function isConnectFailure(err) {
    const cause = typeof err === "object" && err !== null && "cause" in err ? err.cause : undefined;
    const code = readCode(cause) ?? readCode(err);
    return code !== undefined && FALLBACK_CODES.has(code);
}
/**
 * Tries `attempt` per address in order. It goes on only after a connection failure and while
 * the signal is not aborted, and rethrows the last error.
 */
export async function connectFirst(addresses, attempt, signal) {
    if (addresses.length === 0)
        throw new TypeError("no address to connect to");
    let lastError;
    for (const address of addresses) {
        try {
            return await attempt(address);
        }
        catch (err) {
            lastError = err;
            if (!isConnectFailure(err) || signal?.aborted === true)
                throw err;
        }
    }
    throw lastError;
}
