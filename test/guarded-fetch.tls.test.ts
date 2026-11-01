import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { createGuardedFetch } from "../src/guarded-fetch.ts";

interface Seen {
  host: string | undefined;
  servername: string | false | null | undefined;
}

interface TestServer {
  server: Server;
  port: number;
  seen: Seen[];
  sockets: () => number;
}

let dir = "";
let key = "";
let cert = "";
const servers: Server[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kit-tls-"));
  execFileSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- openssl from PATH makes a test-only certificate
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-subj",
      "/CN=pinned.test",
      "-addext",
      "subjectAltName=DNS:pinned.test",
      "-days",
      "2",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
    ],
    { stdio: "ignore" },
  );
  key = readFileSync(join(dir, "key.pem"), "utf8");
  cert = readFileSync(join(dir, "cert.pem"), "utf8");
});

afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
  rmSync(dir, { recursive: true, force: true });
});

async function startServer(): Promise<TestServer> {
  const seen: Seen[] = [];
  let count = 0;
  const server = createServer({ key, cert }, (req, res) => {
    seen.push({ host: req.headers.host, servername: (req.socket as TLSSocket).servername });
    res.end("ok");
  });
  server.on("secureConnection", () => {
    count += 1;
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, port, seen, sockets: () => count };
}

const lookups: string[] = [];
const guarded = createGuardedFetch({
  fetch,
  lookup: (host) => {
    lookups.push(host);
    return Promise.resolve(["127.0.0.1"]);
  },
  classify: () => null,
});

async function errorCode(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return (err as { code?: unknown }).code;
  }
  return "resolved";
}

describe("guarded fetch over real TLS", () => {
  test("a trusted certificate for the original name answers 200", async () => {
    const s = await startServer();
    lookups.length = 0;
    const res = await guarded(`https://pinned.test:${s.port}/`, {
      redirect: "manual",
      tls: { ca: cert },
    });
    expect(res.status).toBe(200);
    await res.text();
    assert.deepEqual(s.seen, [{ host: `pinned.test:${s.port}`, servername: "pinned.test" }]);
    assert.deepEqual(lookups, ["pinned.test"]);
  });

  test("a trusted certificate for another name is rejected", async () => {
    const s = await startServer();
    const code = await errorCode(
      guarded(`https://other.test:${s.port}/`, { redirect: "manual", tls: { ca: cert } }),
    );
    assert.equal(code, "ERR_TLS_CERT_ALTNAME_INVALID");
    assert.equal(s.seen.length, 0);
  });

  test("a pooled connection does not skip the name check", async () => {
    const s = await startServer();
    const pinned = `https://pinned.test:${s.port}/`;
    const first = await guarded(pinned, { redirect: "manual", tls: { ca: cert } });
    assert.equal(first.status, 200);
    await first.text();
    const code = await errorCode(
      guarded(`https://other.test:${s.port}/`, { redirect: "manual", tls: { ca: cert } }),
    );
    assert.equal(code, "ERR_TLS_CERT_ALTNAME_INVALID");
    const third = await guarded(pinned, { redirect: "manual", tls: { ca: cert } });
    assert.equal(third.status, 200);
    await third.text();
    assert.deepEqual(
      s.seen.map((x) => x.host),
      [`pinned.test:${s.port}`, `pinned.test:${s.port}`],
    );
  });

  test("an untrusted certificate is rejected", async () => {
    const s = await startServer();
    const code = await errorCode(guarded(`https://pinned.test:${s.port}/`, { redirect: "manual" }));
    assert.equal(code, "DEPTH_ZERO_SELF_SIGNED_CERT");
    assert.equal(s.seen.length, 0);
  });
});
