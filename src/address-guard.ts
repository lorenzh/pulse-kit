import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type AddressClassifier, normalizeAddress } from "./ip-classifier.ts";

/** A connection target is in a blocked category. The message holds no host or address. */
export class BlockedAddressError extends Error {
  override name = "BlockedAddressError";
  readonly category: string;

  constructor(category: string) {
    super(`blocked ${category} address`);
    this.category = category;
  }
}

/** Resolves a host name to all its addresses, in answer order. */
export type LookupAll = (host: string) => Promise<readonly string[]>;

/** The system resolver (`/etc/hosts` included) through `node:dns/promises` `lookup`. */
export const lookupAll: LookupAll = async (host) => {
  const answers = await lookup(host, { all: true });
  return answers.map((answer) => answer.address);
};

export interface ResolveOptions {
  lookup: LookupAll;
  classify: AddressClassifier;
  signal?: AbortSignal | undefined;
}

function raceSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function notFound(): Error {
  return Object.assign(new Error("no address found"), { code: "ENOTFOUND" });
}

/**
 * Returns the addresses of `host` when none of them is blocked. A mixed answer is blocked by
 * the first blocked address in answer order; a non-IP answer is `unrecognized`.
 */
export async function resolveAllowed(
  host: string,
  { lookup: lookupImpl, classify, signal }: ResolveOptions,
): Promise<readonly string[]> {
  signal?.throwIfAborted();
  const literal = normalizeAddress(host);
  const addresses = isIP(literal) === 0 ? await raceSignal(lookupImpl(host), signal) : [literal];
  if (addresses.length === 0) throw notFound();
  const allowed: string[] = [];
  for (const raw of addresses) {
    const address = normalizeAddress(raw);
    if (isIP(address) === 0) throw new BlockedAddressError("unrecognized");
    const category = classify(address);
    if (category !== null) throw new BlockedAddressError(category);
    allowed.push(address);
  }
  return allowed;
}

/** No request was sent for these codes, so the next address may be tried. */
const FALLBACK_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "ConnectionRefused",
]);

function readCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

function isConnectFailure(err: unknown): boolean {
  const cause = typeof err === "object" && err !== null && "cause" in err ? err.cause : undefined;
  const code = readCode(cause) ?? readCode(err);
  return code !== undefined && FALLBACK_CODES.has(code);
}

/**
 * Tries `attempt` per address in order. It goes on only after a connection failure and while
 * the signal is not aborted, and rethrows the last error.
 */
export async function connectFirst<T>(
  addresses: readonly string[],
  attempt: (address: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (addresses.length === 0) throw new TypeError("no address to connect to");
  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await attempt(address);
    } catch (err) {
      lastError = err;
      if (!isConnectFailure(err) || signal?.aborted === true) throw err;
    }
  }
  throw lastError;
}
