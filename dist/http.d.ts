import type { IncomingMessage, ServerResponse } from "node:http";
export declare class BodyError extends Error {
    readonly status: 400 | 413;
    readonly code: "too-large" | "invalid-json" | "aborted";
    constructor(code: BodyError["code"], message: string);
}
export declare function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void;
/** Reads the request body as UTF-8 text. Rejects with `BodyError` over `maxBytes` or on abort. */
export declare function readBody(req: IncomingMessage, maxBytes: number): Promise<string>;
export declare function readJsonBody(req: IncomingMessage, opts: {
    maxBytes: number;
}): Promise<unknown>;
