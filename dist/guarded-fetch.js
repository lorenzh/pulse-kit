/**
 * A fetch that connects only to resolved and allowed addresses. It needs Bun: it relies on
 * Bun's `tls.serverName` fetch option.
 */
import { connectFirst, resolveAllowed } from "./address-guard.js";
function parseTarget(input, init) {
    if (input instanceof Request)
        throw new TypeError("guarded fetch does not accept a Request");
    if (init?.redirect !== "manual" && init?.redirect !== "error") {
        throw new TypeError('guarded fetch needs redirect "manual" or "error"');
    }
    if (init.unix !== undefined || init.proxy !== undefined) {
        throw new TypeError("guarded fetch does not accept unix or proxy");
    }
    let url;
    try {
        url = new URL(input);
    }
    catch {
        // No cause: the parser error holds the input URL, which may carry credentials.
        throw new TypeError("guarded fetch needs a valid URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new TypeError("guarded fetch needs an http or https URL");
    }
    return url;
}
function isIpLiteralHost(hostname) {
    // The WHATWG URL parser normalizes every IPv4 spelling to dotted form and brackets IPv6.
    return hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}
function pinnedInit(url, init) {
    const headers = new Headers(init.headers);
    headers.set("host", url.host);
    if (url.protocol !== "https:")
        return { ...init, headers };
    // serverName takes precedence over Host for SNI and certificate checks in Bun, and Bun keys
    // its connection pool by it, so a pooled socket is never reused for another name.
    return { ...init, headers, tls: { ...init.tls, serverName: url.hostname } };
}
/** Wraps `fetch` so every call resolves the host, checks every address and connects to one. */
export function createGuardedFetch({ fetch, lookup, classify }) {
    return async (input, init) => {
        const url = parseTarget(input, init);
        const options = init ?? {};
        const addresses = await resolveAllowed(url.hostname, {
            lookup,
            classify,
            signal: options.signal ?? undefined,
        });
        if (isIpLiteralHost(url.hostname))
            return fetch(url.href, options);
        const pinned = pinnedInit(url, options);
        return connectFirst(addresses, (address) => {
            const target = new URL(url);
            target.hostname = address.includes(":") ? `[${address}]` : address;
            return fetch(target.href, pinned);
        }, options.signal ?? undefined);
    };
}
