/**
 * A fetch that connects only to resolved and allowed addresses. It needs Bun: it relies on
 * Bun's `tls.serverName` fetch option.
 */
import { connectFirst, type LookupAll, resolveAllowed } from "./address-guard.ts";
import type { AddressClassifier } from "./ip-classifier.ts";

export type GuardedFetch = (
  input: string | URL | Request,
  init?: BunFetchRequestInit,
) => Promise<Response>;

export interface GuardedFetchOptions {
  fetch: (input: string, init: BunFetchRequestInit) => Promise<Response>;
  lookup: LookupAll;
  classify: AddressClassifier;
}

function parseTarget(input: string | URL | Request, init: BunFetchRequestInit | undefined): URL {
  if (input instanceof Request) throw new TypeError("guarded fetch does not accept a Request");
  if (init?.redirect !== "manual" && init?.redirect !== "error") {
    throw new TypeError('guarded fetch needs redirect "manual" or "error"');
  }
  if (init.unix !== undefined || init.proxy !== undefined) {
    throw new TypeError("guarded fetch does not accept unix or proxy");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    // No cause: the parser error holds the input URL, which may carry credentials.
    throw new TypeError("guarded fetch needs a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("guarded fetch needs an http or https URL");
  }
  return url;
}

/**
 * Copies the caller's options once. The guard validates and sends this copy, so a caller that
 * changes its own object while the lookup runs cannot switch on redirects, a proxy or a socket.
 */
function snapshotInit(init: BunFetchRequestInit | undefined): BunFetchRequestInit | undefined {
  if (init === undefined) return undefined;
  const copy: BunFetchRequestInit = { ...init };
  if (init.tls !== undefined) copy.tls = { ...init.tls };
  return copy;
}

function isIpLiteralHost(hostname: string): boolean {
  // The WHATWG URL parser normalizes every IPv4 spelling to dotted form and brackets IPv6.
  return hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}

function parseHeaders(init: BunFetchRequestInit): Headers {
  try {
    return new Headers(init.headers);
  } catch {
    // No cause: the Headers error quotes the bad value, which may be a credential.
    throw new TypeError("guarded fetch needs valid headers");
  }
}

function pinnedInit(url: URL, init: BunFetchRequestInit, headers: Headers): BunFetchRequestInit {
  headers.set("host", url.host);
  if (url.protocol !== "https:") return { ...init, headers };
  // serverName takes precedence over Host for SNI and certificate checks in Bun, and Bun keys
  // its connection pool by it, so a pooled socket is never reused for another name.
  return { ...init, headers, tls: { ...init.tls, serverName: url.hostname } };
}

const redactedFields = ["path", "message", "stack"] as const;

function redactUrl(value: unknown, target: URL): void {
  if (typeof value !== "object" || value === null) return;
  // Bun puts the full URL, with credentials and query, in `path` and in some messages.
  // The fields cannot be deleted, but they can be overwritten.
  for (const field of redactedFields) {
    if (field in value) {
      const text: unknown = Reflect.get(value, field);
      if (typeof text === "string" && text.includes(target.href)) {
        Object.assign(value, { [field]: text.replaceAll(target.href, target.origin) });
      } else if (field === "path" && typeof text === "string") {
        Object.assign(value, { path: target.origin });
      }
    }
  }
}

/** Calls the transport and keeps the URL's credentials and query out of its error. */
async function send(
  fetch: GuardedFetchOptions["fetch"],
  target: URL,
  init: BunFetchRequestInit,
): Promise<Response> {
  try {
    return await fetch(target.href, init);
  } catch (err) {
    redactUrl(err, target);
    if (err instanceof Error) redactUrl(err.cause, target);
    throw err;
  }
}

/** Wraps `fetch` so every call resolves the host, checks every address and connects to one. */
export function createGuardedFetch({ fetch, lookup, classify }: GuardedFetchOptions): GuardedFetch {
  return async (input, callerInit) => {
    const init = snapshotInit(callerInit);
    const url = parseTarget(input, init);
    const options: BunFetchRequestInit = init ?? {};
    const headers = parseHeaders(options);
    const addresses = await resolveAllowed(url.hostname, {
      lookup,
      classify,
      signal: options.signal ?? undefined,
    });
    if (isIpLiteralHost(url.hostname)) {
      // Through connectFirst too, so an abort after the lookup still stops the attempt. The
      // validated header copy is sent, so a caller cannot swap in a bad value during the lookup.
      const literal: BunFetchRequestInit = { ...options, headers };
      return connectFirst(addresses, () => send(fetch, url, literal), options.signal ?? undefined);
    }
    const pinned = pinnedInit(url, options, headers);
    return connectFirst(
      addresses,
      (address) => {
        const target = new URL(url);
        target.hostname = address.includes(":") ? `[${address}]` : address;
        return send(fetch, target, pinned);
      },
      options.signal ?? undefined,
    );
  };
}
