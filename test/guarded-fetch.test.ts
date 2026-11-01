import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { createGuardedFetch } from "../src/guarded-fetch.ts";
import { createIpClassifier } from "../src/ip-classifier.ts";

const classify = createIpClassifier([
  { category: "loopback", cidrs: ["127.0.0.0/8", "::1/128"] },
  { category: "private", cidrs: ["198.51.100.0/24"] },
]);

interface Call {
  url: string;
  init: BunFetchRequestInit;
}

function setup(
  answers: readonly (readonly string[])[],
  respond: (url: string) => Promise<Response> = () => Promise.resolve(new Response("ok")),
): {
  guarded: ReturnType<typeof createGuardedFetch>;
  calls: Call[];
  lookups: string[];
} {
  const calls: Call[] = [];
  const lookups: string[] = [];
  const guarded = createGuardedFetch({
    classify,
    lookup: (host) => {
      lookups.push(host);
      return Promise.resolve(answers[Math.min(lookups.length - 1, answers.length - 1)] ?? []);
    },
    fetch: (url, init) => {
      calls.push({ url, init });
      return respond(url);
    },
  });
  return { guarded, calls, lookups };
}

function refused(code: string, inCause: boolean): Error {
  const inner = Object.assign(new Error("connect"), { code });
  return inCause ? new Error("fetch failed", { cause: inner }) : inner;
}

describe("redirect mode and inputs", () => {
  test("absent or follow redirect is a TypeError before any lookup", async () => {
    const { guarded, lookups } = setup([["203.0.113.10"]]);
    await assert.rejects(guarded("http://public.test/", {}), TypeError);
    await assert.rejects(guarded("http://public.test/"), TypeError);
    await assert.rejects(guarded("http://public.test/", { redirect: "follow" }), TypeError);
    assert.equal(lookups.length, 0);
    await guarded("http://public.test/", { redirect: "manual" });
    await guarded("http://public.test/", { redirect: "error" });
    assert.equal(lookups.length, 2);
  });

  test("Request, unix, proxy, other protocols and bad URLs are a TypeError", async () => {
    const { guarded, lookups, calls } = setup([["203.0.113.10"]]);
    await assert.rejects(
      guarded(new Request("http://public.test/"), { redirect: "manual" }),
      TypeError,
    );
    await assert.rejects(
      guarded("http://public.test/", { redirect: "manual", unix: "x.sock" }),
      TypeError,
    );
    await assert.rejects(
      guarded("http://public.test/", { redirect: "manual", proxy: "http://p.test" }),
      TypeError,
    );
    await assert.rejects(guarded("file:///etc/passwd", { redirect: "manual" }), TypeError);
    await assert.rejects(guarded("not a url", { redirect: "manual" }), TypeError);
    assert.equal(lookups.length, 0);
    assert.equal(calls.length, 0);
  });

  test("a bad URL error holds no part of the input", async () => {
    const { guarded } = setup([["203.0.113.10"]]);
    const input = "https://user:pw-sentinel@[bad/?q=query-sentinel";
    const err: unknown = await guarded(input, { redirect: "manual" }).catch((e: unknown) => e);
    assert.ok(err instanceof TypeError);
    const seen = Bun.inspect(err);
    assert.equal(seen.includes("pw-sentinel"), false);
    assert.equal(seen.includes("query-sentinel"), false);
  });

  test("a bad header error holds no part of the value", async () => {
    const { guarded, calls, lookups } = setup([["203.0.113.10"]]);
    const err: unknown = await guarded("https://flip.test/", {
      redirect: "manual",
      headers: { authorization: "Bearer header-sentinel\r\nX: y" },
    }).catch((e: unknown) => e);
    assert.ok(err instanceof TypeError);
    assert.equal(Bun.inspect(err).includes("header-sentinel"), false);
    assert.deepEqual(lookups, []);
    assert.equal(calls.length, 0);
  });
});

describe("validation vs connection", () => {
  test("http connects to the validated address with the original host", async () => {
    const { guarded, calls, lookups } = setup([["203.0.113.10"]]);
    const res = await guarded("http://flip.test:8080/a?b=1", {
      redirect: "manual",
      method: "POST",
      headers: { "x-token": "t", host: "evil.test" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(lookups, ["flip.test"]);
    assert.equal(calls.length, 1);
    const [call] = calls;
    const target = new URL(call?.url ?? "");
    assert.equal(target.protocol, "http:");
    assert.equal(target.host, "203.0.113.10:8080");
    assert.equal(`${target.pathname}${target.search}`, "/a?b=1");
    const headers = new Headers(call?.init.headers);
    assert.equal(headers.get("host"), "flip.test:8080");
    assert.equal(headers.get("x-token"), "t");
    assert.equal(call?.init.method, "POST");
    assert.equal(call?.init.redirect, "manual");
    assert.equal(call?.init.tls, undefined);
  });

  test("https sets serverName and keeps the caller's tls fields", async () => {
    const { guarded, calls } = setup([["2001:db8::1"]]);
    await guarded("https://flip.test/", { redirect: "manual", tls: { ca: "CA" } });
    const [call] = calls;
    assert.equal(call?.url, "https://[2001:db8::1]/");
    assert.equal(new Headers(call?.init.headers).get("host"), "flip.test");
    assert.deepEqual(call?.init.tls, { ca: "CA", serverName: "flip.test" });
  });

  test("an IP literal URL passes unchanged", async () => {
    const { guarded, calls, lookups } = setup([["203.0.113.10"]]);
    const init: BunFetchRequestInit = { redirect: "manual", headers: { a: "1" } };
    await guarded("https://[2001:db8::1]:8443/", init);
    assert.equal(lookups.length, 0);
    assert.equal(calls[0]?.url, "https://[2001:db8::1]:8443/");
    const { headers, ...rest } = calls[0]?.init ?? {};
    assert.deepEqual(rest, { redirect: "manual" });
    assert.deepEqual(Object.fromEntries(new Headers(headers)), { a: "1" });
  });

  test("an IP literal sends the validated headers, not the caller's object", async () => {
    const { guarded, calls } = setup([]);
    const headers: Record<string, string> = { authorization: "Bearer ok" };
    const pending = guarded("https://203.0.113.10/", { redirect: "manual", headers });
    headers.authorization = "Bearer header-sentinel\r\nX: y";
    await pending;
    assert.equal(calls.length, 1);
    assert.equal(new Headers(calls[0]?.init.headers).get("authorization"), "Bearer ok");
  });

  test("options changed during the lookup do not reach the transport", async () => {
    const calls: Call[] = [];
    const init: BunFetchRequestInit = { redirect: "manual", tls: { rejectUnauthorized: true } };
    const guarded = createGuardedFetch({
      classify,
      lookup: () => {
        Object.assign(init, { redirect: "follow", proxy: "http://proxy.test/" });
        Object.assign(init.tls ?? {}, { rejectUnauthorized: false });
        return Promise.resolve(["203.0.113.10"]);
      },
      fetch: (url, sent) => {
        calls.push({ url, init: sent });
        return Promise.resolve(new Response("ok"));
      },
    });
    await guarded("https://public.test/", init);
    assert.equal(calls[0]?.init.redirect, "manual");
    assert.equal(calls[0]?.init.proxy, undefined);
    assert.equal(calls[0]?.init.tls?.rejectUnauthorized, true);
  });

  test("a blocked literal or answer makes no fetch call", async () => {
    const { guarded, calls } = setup([["203.0.113.10", "198.51.100.5"]]);
    await assert.rejects(guarded("http://127.1:9/", { redirect: "manual" }), {
      name: "BlockedAddressError",
      category: "loopback",
    });
    await assert.rejects(guarded("http://mixed.test/", { redirect: "manual" }), {
      category: "private",
    });
    assert.equal(calls.length, 0);
  });
});

describe("DNS change", () => {
  test("each call resolves again", async () => {
    const { guarded, calls, lookups } = setup([["203.0.113.10"], ["127.0.0.1"]]);
    await guarded("http://flip.test/", { redirect: "manual" });
    await assert.rejects(guarded("http://flip.test/next", { redirect: "manual" }), {
      category: "loopback",
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(lookups, ["flip.test", "flip.test"]);
  });
});

describe("fallback", () => {
  for (const [code, inCause] of [
    ["ECONNREFUSED", true],
    ["ConnectionRefused", false],
  ] as const) {
    test(`goes on after ${code}`, async () => {
      const { guarded, calls } = setup([["2001:db8::1", "203.0.113.10"]], (url) =>
        url.includes("[")
          ? Promise.reject(refused(code, inCause))
          : Promise.resolve(new Response()),
      );
      const res = await guarded("http://multi.test/", { redirect: "manual" });
      assert.equal(res.status, 200);
      assert.deepEqual(
        calls.map((c) => {
          const url = new URL(c.url);
          return [url.protocol, url.host, url.pathname];
        }),
        [
          ["http:", "[2001:db8::1]", "/"],
          ["http:", "203.0.113.10", "/"],
        ],
      );
    });
  }

  for (const err of [new DOMException("t", "TimeoutError"), refused("ECONNRESET", false)]) {
    test(`stops after ${err.name}`, async () => {
      const { guarded, calls } = setup([["2001:db8::1", "203.0.113.10"]], () =>
        Promise.reject(err),
      );
      await assert.rejects(
        guarded("http://multi.test/", { redirect: "manual" }),
        (e: unknown) => e === err,
      );
      assert.equal(calls.length, 1);
    });
  }
});

describe("cancellation", () => {
  test("an abort after the call starts stops an IP literal target", async () => {
    const { guarded, calls } = setup([]);
    const controller = new AbortController();
    const pending = guarded("https://203.0.113.10/", {
      redirect: "manual",
      signal: controller.signal,
    });
    controller.abort(new Error("stop"));
    await assert.rejects(pending, { message: "stop" });
    assert.equal(calls.length, 0);
  });
});

describe("transport errors", () => {
  test("a real connect error holds no credentials or query", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = server.port;
    await server.stop(true);
    const guarded = createGuardedFetch({
      classify: createIpClassifier([]),
      lookup: () => Promise.resolve(["127.0.0.1"]),
      fetch: (url, init) => fetch(url, init),
    });
    const err: unknown = await guarded(
      `http://user:pw-sentinel@pinned.test:${port}/?q=query-sentinel`,
      {
        redirect: "manual",
      },
    ).catch((e: unknown) => e);
    assert.ok(err instanceof Error);
    const text = Bun.inspect(err);
    assert.equal(text.includes("pw-sentinel"), false);
    assert.equal(text.includes("query-sentinel"), false);
    assert.equal((err as Error & { code?: unknown }).code, "ConnectionRefused");
  });

  test("a malformed response error holds no credentials or query", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket) {
          socket.end("HTTP/1.1 200 OK\r\nbad header\r\n\r\n");
        },
      },
    });
    const guarded = createGuardedFetch({
      classify: createIpClassifier([]),
      lookup: () => Promise.resolve(["127.0.0.1"]),
      fetch: (url, init) => fetch(url, init),
    });
    try {
      const err: unknown = await guarded(
        `http://user:pw-sentinel@pinned.test:${server.port}/?q=query-sentinel`,
        { redirect: "manual" },
      ).catch((e: unknown) => e);
      assert.ok(err instanceof Error);
      const text = `${Bun.inspect(err)} ${err.message} ${err.stack ?? ""}`;
      assert.equal(text.includes("pw-sentinel"), false);
      assert.equal(text.includes("query-sentinel"), false);
    } finally {
      server.stop(true);
    }
  });
});
