import type { IncomingMessage, ServerResponse } from "node:http";

export class BodyError extends Error {
  readonly status: 400 | 413;
  readonly code: "too-large" | "invalid-json" | "aborted";

  constructor(code: BodyError["code"], message: string) {
    super(message);
    this.name = "BodyError";
    this.code = code;
    this.status = code === "too-large" ? 413 : 400;
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

/** Reads the request body as UTF-8 text. Rejects with `BodyError` over `maxBytes` or on abort. */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(new BodyError("too-large", `body exceeds ${maxBytes} bytes`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let isDone = false;
    const finish = (fn: () => void): void => {
      if (isDone) return;
      isDone = true;
      fn();
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(() => reject(new BodyError("too-large", `body exceeds ${maxBytes} bytes`)));
        req.pause();
        req.removeAllListeners("data");
        req.resume(); // drain and drop the rest so the response can still be sent
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(() => resolve(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", (cause) =>
      finish(() => reject(new BodyError("aborted", `request failed: ${cause.message}`))),
    );
    req.on("close", () =>
      finish(() => reject(new BodyError("aborted", "request closed before the body ended"))),
    );
  });
}

export async function readJsonBody(
  req: IncomingMessage,
  opts: { maxBytes: number },
): Promise<unknown> {
  const text = await readBody(req, opts.maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError("invalid-json", "body is not valid JSON");
  }
}
