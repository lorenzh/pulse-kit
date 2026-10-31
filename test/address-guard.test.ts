import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import {
  BlockedAddressError,
  connectFirst,
  lookupAll,
  resolveAllowed,
} from "../src/address-guard.ts";
import { createIpClassifier } from "../src/ip-classifier.ts";

const classify = createIpClassifier([
  { category: "loopback", cidrs: ["127.0.0.0/8", "::1/128"] },
  { category: "private", cidrs: ["198.51.100.0/24"] },
]);

function fakeLookup(answer: readonly string[]): {
  lookup: (host: string) => Promise<readonly string[]>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    lookup: (host) => {
      calls.push(host);
      return Promise.resolve(answer);
    },
  };
}

function codeError(code: string, inCause: boolean): Error {
  const inner = Object.assign(new Error("connect"), { code });
  return inCause ? new Error("fetch failed", { cause: inner }) : inner;
}

describe("BlockedAddressError", () => {
  test("has name, category and message", () => {
    const err = new BlockedAddressError("private");
    assert.equal(err.name, "BlockedAddressError");
    assert.equal(err.category, "private");
    assert.equal(err.message, "blocked private address");
    assert.ok(err instanceof Error);
  });
});

describe("resolveAllowed", () => {
  test("returns allowed addresses in answer order", async () => {
    const { lookup, calls } = fakeLookup(["2001:db8::1", "203.0.113.10"]);
    assert.deepEqual(await resolveAllowed("public.test", { lookup, classify }), [
      "2001:db8::1",
      "203.0.113.10",
    ]);
    assert.deepEqual(calls, ["public.test"]);
  });

  test("a mixed answer is blocked by the first blocked address", async () => {
    const mixed = fakeLookup(["203.0.113.10", "198.51.100.5"]);
    await assert.rejects(resolveAllowed("mixed.test", { lookup: mixed.lookup, classify }), {
      name: "BlockedAddressError",
      category: "private",
      message: "blocked private address",
    });
    const order = fakeLookup(["198.51.100.5", "127.0.0.1"]);
    await assert.rejects(resolveAllowed("x.test", { lookup: order.lookup, classify }), {
      category: "private",
    });
  });

  test("an empty answer rejects with ENOTFOUND", async () => {
    const { lookup } = fakeLookup([]);
    await assert.rejects(resolveAllowed("none.test", { lookup, classify }), {
      code: "ENOTFOUND",
    });
  });

  test("a non-IP answer is unrecognized", async () => {
    const { lookup } = fakeLookup(["203.0.113.10", "garbage"]);
    await assert.rejects(resolveAllowed("odd.test", { lookup, classify }), {
      name: "BlockedAddressError",
      category: "unrecognized",
    });
  });

  test("an IP literal calls no lookup", async () => {
    const { lookup, calls } = fakeLookup(["203.0.113.10"]);
    assert.deepEqual(await resolveAllowed("[2001:db8::1]", { lookup, classify }), ["2001:db8::1"]);
    await assert.rejects(resolveAllowed("[::1]", { lookup, classify }), { category: "loopback" });
    assert.deepEqual(calls, []);
  });

  test("an abort before the lookup settles rejects with the reason", async () => {
    const controller = new AbortController();
    const lookup = (): Promise<readonly string[]> => new Promise(() => undefined);
    const pending = resolveAllowed("slow.test", { lookup, classify, signal: controller.signal });
    const reason = new DOMException("timed out", "TimeoutError");
    controller.abort(reason);
    await assert.rejects(pending, (err: unknown) => err === reason);
  });

  test("an already aborted signal rejects without a lookup", async () => {
    const { lookup, calls } = fakeLookup(["203.0.113.10"]);
    const signal = AbortSignal.abort(new Error("gone"));
    await assert.rejects(resolveAllowed("a.test", { lookup, classify, signal }), {
      message: "gone",
    });
    assert.deepEqual(calls, []);
  });
});

describe("lookupAll", () => {
  test("resolves localhost through the system resolver", async () => {
    assert.ok((await lookupAll("localhost")).includes("127.0.0.1"));
  });

  test("a lookup error passes through with a signal", async () => {
    const lookup = (): Promise<readonly string[]> =>
      Promise.reject(Object.assign(new Error("nope"), { code: "ENOTFOUND" }));
    const signal = new AbortController().signal;
    await assert.rejects(resolveAllowed("x.invalid", { lookup, classify, signal }), {
      code: "ENOTFOUND",
    });
  });
});

describe("connectFirst", () => {
  test("goes on for connection errors and returns the first success", async () => {
    const cases = [
      codeError("ECONNREFUSED", true),
      codeError("ConnectionRefused", false),
      codeError("EHOSTUNREACH", true),
      codeError("ENETUNREACH", false),
      codeError("EADDRNOTAVAIL", true),
    ];
    for (const first of cases) {
      const tried: string[] = [];
      const result = await connectFirst(["a", "b"], (address) => {
        tried.push(address);
        return address === "a" ? Promise.reject(first) : Promise.resolve("ok");
      });
      assert.equal(result, "ok");
      assert.deepEqual(tried, ["a", "b"]);
    }
  });

  test("stops at once on other errors", async () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    for (const first of [codeError("ECONNRESET", false), timeout]) {
      const tried: string[] = [];
      await assert.rejects(
        connectFirst(["a", "b"], (address) => {
          tried.push(address);
          return Promise.reject(first);
        }),
        (err: unknown) => err === first,
      );
      assert.deepEqual(tried, ["a"]);
    }
  });

  test("rethrows the last error", async () => {
    const last = codeError("ECONNREFUSED", true);
    await assert.rejects(
      connectFirst(["a", "b"], (address) =>
        Promise.reject(address === "a" ? codeError("ECONNREFUSED", true) : last),
      ),
      (err: unknown) => err === last,
    );
  });

  test("does not go on once the signal is aborted", async () => {
    const controller = new AbortController();
    const tried: string[] = [];
    await assert.rejects(
      connectFirst(
        ["a", "b"],
        (address) => {
          tried.push(address);
          controller.abort();
          return Promise.reject(codeError("ECONNREFUSED", true));
        },
        controller.signal,
      ),
    );
    assert.deepEqual(tried, ["a"]);
  });

  test("an empty list throws TypeError", async () => {
    await assert.rejects(
      connectFirst([], () => Promise.resolve(1)),
      TypeError,
    );
  });
});
