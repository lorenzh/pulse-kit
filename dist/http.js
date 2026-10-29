export class BodyError extends Error {
    status;
    code;
    constructor(code, message) {
        super(message);
        this.name = "BodyError";
        this.code = code;
        this.status = code === "too-large" ? 413 : 400;
    }
}
export function sendJson(res, status, body, headers = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        ...headers,
    });
    res.end(payload);
}
/** Reads the request body as UTF-8 text. Rejects with `BodyError` over `maxBytes` or on abort. */
export function readBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) {
            req.resume();
            reject(new BodyError("too-large", `body exceeds ${maxBytes} bytes`));
            return;
        }
        const chunks = [];
        let size = 0;
        let isDone = false;
        const finish = (fn) => {
            if (isDone)
                return;
            isDone = true;
            fn();
        };
        req.on("data", (chunk) => {
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
        req.on("error", (cause) => finish(() => reject(new BodyError("aborted", `request failed: ${cause.message}`))));
        req.on("close", () => finish(() => reject(new BodyError("aborted", "request closed before the body ended"))));
    });
}
export async function readJsonBody(req, opts) {
    const text = await readBody(req, opts.maxBytes);
    try {
        return JSON.parse(text);
    }
    catch {
        throw new BodyError("invalid-json", "body is not valid JSON");
    }
}
