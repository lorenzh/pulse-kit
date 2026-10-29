import { createServer } from "node:http";
import { StartupError } from "./settings.js";
const METRICS_TYPE = "text/plain; version=0.0.4; charset=utf-8";
function sendText(res, status, body, type = "text/plain") {
    res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
    res.end(body);
}
function sendReadiness(res, state) {
    if (state.ready)
        sendText(res, 200, "ok\n");
    else
        sendText(res, 503, `${state.reason}\n`);
}
function sendWrongMethod(res, handlers) {
    if (handlers.methodNotAllowed === "404")
        sendText(res, 404, "not found\n");
    else
        sendText(res, 405, "method not allowed\n");
}
function answer(path, res, handlers) {
    if (path === "/healthz")
        sendReadiness(res, handlers.live?.() ?? { ready: true });
    else if (path === "/readyz")
        sendReadiness(res, handlers.ready());
    else
        sendText(res, 200, handlers.metrics(), METRICS_TYPE);
}
/**
 * Answers /healthz, /readyz and /metrics. Returns true when the path was an ops path and the
 * response is sent, false when the caller must continue.
 */
export function handleOps(req, res, handlers) {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    if (path !== "/healthz" && path !== "/readyz" && path !== "/metrics")
        return false;
    const isAllowed = req.method === "GET" || (handlers.allowHead === true && req.method === "HEAD");
    if (!isAllowed) {
        sendWrongMethod(res, handlers);
        return true;
    }
    try {
        answer(path, res, handlers);
    }
    catch {
        // A failing handler must not take the listener down; the cause is the caller's to log.
        sendText(res, 500, "internal error\n");
    }
    return true;
}
function bindError(cause, setting) {
    const code = Reflect.get(cause, "code");
    if (code === "EADDRINUSE" || code === "EACCES" || code === "EADDRNOTAVAIL") {
        const name = setting ?? "ops port";
        return new StartupError(`${name}: cannot listen (${code})`, { setting, cause });
    }
    return cause;
}
function listen(server, host, port, setting) {
    return new Promise((resolve, reject) => {
        server.once("error", (err) => reject(bindError(err, setting)));
        server.listen(port, host, resolve);
    });
}
export async function startOpsServer(opts) {
    const server = createServer((req, res) => {
        if (handleOps(req, res, opts))
            return;
        sendText(res, 404, "not found\n");
    });
    await listen(server, opts.host, opts.port, opts.setting);
    server.on("error", () => {
        // Late socket errors are per connection; the listener stays up.
    });
    const address = server.address(); // listening on a TCP port, so never a string
    return {
        port: address.port,
        close: () => new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
            server.closeAllConnections();
        }),
    };
}
