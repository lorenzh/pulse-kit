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

/** Wraps `fetch` so every call resolves the host, checks every address and connects to one. */
export function createGuardedFetch({ fetch, lookup, classify }: GuardedFetchOptions): GuardedFetch {
  return async (input, init) => {
    const url = parseTarget(input, init);
    const options: BunFetchRequestInit = init ?? {};
    const headers = parseHeaders(options);
    const addresses = await resolveAllowed(url.hostname, {
      lookup,
      classify,
      signal: options.signal ?? undefined,
    });
    if (isIpLiteralHost(url.hostname)) {
      // Through connectFirst too, so an abort after the lookup still stops the attempt.
      return connectFirst(addresses, () => fetch(url.href, options), options.signal ?? undefined);
    }
    const pinned = pinnedInit(url, options, headers);
    return connectFirst(
      addresses,
      (address) => {
        const target = new URL(url);
        target.hostname = address.includes(":") ? `[${address}]` : address;
        return fetch(target.href, pinned);
      },
      options.signal ?? undefined,
    );
  };
}
