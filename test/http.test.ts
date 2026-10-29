import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { BodyError, readBody, readJsonBody, sendJson } from "../src/http.ts";

const server = createServer((req, res) => {
  handle(req, res).catch(() => res.destroy());
});

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.url === "/json")
      sendJson(res, 200, { got: await readJsonBody(req, { maxBytes: 20 }) }, { "x-a": "b" });
    else sendJson(res, 200, { text: await readBody(req, 20) });
  } catch (err) {
    if (!(err instanceof BodyError)) throw err;
    sendJson(res, err.status, { code: err.code });
  }
}
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

test("readJsonBody parses and sendJson sets headers", async () => {
  const res = await fetch(`${base}/json`, { method: "POST", body: '{"a":1}' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("x-a"), "b");
  assert.deepEqual(await res.json(), { got: { a: 1 } });
});

test("invalid JSON is 400", async () => {
  const res = await fetch(`${base}/json`, { method: "POST", body: "{nope" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { code: "invalid-json" });
});

test("a body over the limit is 413", async () => {
  const res = await fetch(`${base}/raw`, { method: "POST", body: "x".repeat(100) });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { code: "too-large" });
});

test("a chunked body over the limit is 413", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode("x".repeat(15)));
      c.enqueue(new TextEncoder().encode("x".repeat(15)));
      c.close();
    },
  });
  const res = await fetch(`${base}/raw`, { method: "POST", body, duplex: "half" } as RequestInit);
  assert.equal(res.status, 413);
});

test("readBody returns the text", async () => {
  const res = await fetch(`${base}/raw`, { method: "POST", body: "hello" });
  assert.deepEqual(await res.json(), { text: "hello" });
});
