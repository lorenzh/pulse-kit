import { type IncomingMessage, type ServerResponse } from "node:http";
export type Readiness = {
    ready: true;
} | {
    ready: false;
    reason: string;
};
export interface OpsHandlers {
    /** Answers /healthz. Default: always ready. */
    live?: () => Readiness;
    /** Answers /readyz. */
    ready: () => Readiness;
    /** Prometheus text for /metrics. */
    metrics: () => string;
    /** Also answer HEAD. Default false. */
    allowHead?: boolean;
    /** Status for a wrong method. Default "405". */
    methodNotAllowed?: "404" | "405";
}
export interface OpsServer {
    port: number;
    close(): Promise<void>;
}
/**
 * Answers /healthz, /readyz and /metrics. Returns true when the path was an ops path and the
 * response is sent, false when the caller must continue.
 */
export declare function handleOps(req: IncomingMessage, res: ServerResponse, handlers: OpsHandlers): boolean;
export declare function startOpsServer(opts: OpsHandlers & {
    host: string;
    port: number;
    setting?: string;
}): Promise<OpsServer>;
