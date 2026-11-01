import { describe, test } from "bun:test";
import assert from "node:assert/strict";
import { createIpClassifier } from "../src/ip-classifier.ts";

// The fixtures use the documentation ranges (RFC 5737, RFC 3849) and loopback, which the shared
// lint config accepts as hard-coded addresses. The mechanics are the same for any range.
const mapped = (ipv4: string): string => `::ffff:${ipv4}`;

describe("createIpClassifier", () => {
  test("the first matching rule wins", () => {
    const classify = createIpClassifier([
      { category: "a", cidrs: ["198.51.100.0/24"] },
      { category: "b", cidrs: ["198.51.100.128/25"] },
    ]);
    assert.equal(classify("198.51.100.200"), "a");
    assert.equal(classify("203.0.113.1"), null);
  });

  test("a bad CIDR throws TypeError at creation without the value", () => {
    for (const cidr of ["198.51.100.0/33", "not-an-ip/8", "2001:db8::/129", "198.51.100.0/x"]) {
      assert.throws(
        () => createIpClassifier([{ category: "x", cidrs: [cidr] }]),
        (err: unknown) => err instanceof TypeError && !err.message.includes(cidr),
      );
    }
  });

  test("a CIDR with a zone throws TypeError", () => {
    for (const cidr of ["2001:db8::1%eth0/64", "2001:db8::1%eth0"]) {
      assert.throws(
        () => createIpClassifier([{ category: "x", cidrs: [cidr] }]),
        (err: unknown) => err instanceof TypeError && !err.message.includes(cidr),
      );
    }
  });

  test("a non-IP value is null", () => {
    const classify = createIpClassifier([{ category: "x", cidrs: ["0.0.0.0/0"] }]);
    assert.equal(classify("example.com"), null);
    assert.equal(classify(""), null);
  });

  test("a bare IP means one address", () => {
    const classify = createIpClassifier([{ category: "m", cidrs: ["203.0.113.254"] }]);
    assert.equal(classify("203.0.113.254"), "m");
    assert.equal(classify("203.0.113.253"), null);
  });

  test("brackets, zone and spaces are removed", () => {
    const classify = createIpClassifier([{ category: "ll", cidrs: ["2001:db8:1::/48"] }]);
    assert.equal(classify("[2001:db8:1::1]"), "ll");
    assert.equal(classify("2001:db8:1::1%eth0"), "ll");
    assert.equal(classify(" [2001:db8:1::1%eth0] "), "ll");
    assert.equal(classify("2001:db8:2::1"), null);
  });

  test("IPv4-mapped IPv6 matches IPv4 rules", () => {
    const classify = createIpClassifier([
      { category: "lo", cidrs: ["127.0.0.0/8"] },
      { category: "p", cidrs: ["198.51.100.0/24", "2001:db8::/32"] },
    ]);
    assert.equal(classify(mapped("127.0.0.1")), "lo");
    assert.equal(classify(mapped("7f00:1")), "lo");
    assert.equal(classify(`[${mapped("198.51.100.1")}]`), "p");
    assert.equal(classify("2001:db8::1"), "p");
    assert.equal(classify(mapped("203.0.113.1")), null);
  });
});
