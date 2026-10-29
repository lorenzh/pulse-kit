import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { handleOps, type OpsServer, type Readiness, startOpsServer } from "../src/ops-server.ts";
import { StartupError } from "../src/settings.ts";

let live: Readiness = { ready: true };
let ready: Readiness = { ready: true };
const servers: OpsServer[] = [];
after(async () => {
  for (const s of servers) await s.close();
});

async function start(
  extra: { allowHead?: boolean; methodNotAllowed?: "404" | "405" } = {},
): Promise<string> {
  const s = await startOpsServer({
    host: "127.0.0.1",
    port: 0,
    live: () => live,
    ready: () => ready,
    metrics: () => "m 1\n",
    ...extra,
  });
  servers.push(s);
  return `http://127.0.0.1:${s.port}`;
}

test("healthz, readyz and metrics", async () => {
  const base = await start();
  let res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok\n");
  ready = { ready: false, reason: "no data" };
  res = await fetch(`${base}/readyz`);
  assert.equal(res.status, 503);
  assert.equal(await res.text(), "no data\n");
  live = { ready: false, reason: "starting" };
  res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 503);
  assert.equal(await res.text(), "starting\n");
  res = await fetch(`${base}/metrics`);
  assert.equal(res.headers.get("content-type"), "text/plain; version=0.0.4; charset=utf-8");
  assert.equal(await res.text(), "m 1\n");
  live = { ready: true };
  ready = { ready: true };
});

test("unknown path is 404; wrong method is 405 or 404 by option; HEAD only when allowed", async () => {
  const base = await start();
  assert.equal((await fetch(`${base}/nope`)).status, 404);
  assert.equal((await fetch(`${base}/healthz`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/healthz`, { method: "HEAD" })).status, 405);
  const legacy = await start({ methodNotAllowed: "404" });
  assert.equal((await fetch(`${legacy}/healthz`, { method: "POST" })).status, 404);
  const head = await start({ allowHead: true });
  assert.equal((await fetch(`${head}/healthz`, { method: "HEAD" })).status, 200);
});

test("handleOps returns false for other paths so the caller continues", async () => {
  const server = createServer((req, res) => {
    if (handleOps(req, res, { ready: () => ({ ready: true }), metrics: () => "x\n" })) return;
    res.writeHead(418).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/other`)).status, 418);
    assert.equal((await fetch(`${base}/readyz`)).status, 200);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("a throwing handler answers 500", async () => {
  const s = await startOpsServer({
    host: "127.0.0.1",
    port: 0,
    ready: () => {
      throw new Error("x");
    },
    metrics: () => "",
  });
  servers.push(s);
  assert.equal((await fetch(`http://127.0.0.1:${s.port}/readyz`)).status, 500);
});

test("a port in use rejects with StartupError naming the setting", async () => {
  const busy = await startOpsServer({
    host: "127.0.0.1",
    port: 0,
    ready: () => ({ ready: true }),
    metrics: () => "",
  });
  servers.push(busy);
  await assert.rejects(
    startOpsServer({
      host: "127.0.0.1",
      port: busy.port,
      setting: "PULSE_HEALTH_PORT",
      ready: () => ({ ready: true }),
      metrics: () => "",
    }),
    (err) =>
      err instanceof StartupError &&
      err.setting === "PULSE_HEALTH_PORT" &&
      err.message.startsWith("PULSE_HEALTH_PORT:"),
  );
});
