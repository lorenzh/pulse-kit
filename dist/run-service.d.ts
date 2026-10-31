import type { Logger } from "./logger.ts";
export interface RunServiceOptions {
    /** Service name, such as "probe". Prefixes startup error lines. */
    service: string;
    start: () => Promise<void>;
    /** Idempotent graceful stop. */
    stop: (signal: string) => Promise<void>;
    /** Bound on `stop`: an integer from 1 to 2147483647. */
    timeoutMs: number;
    /** Exit code when `stop` does not finish in time. Default 1; an integer from 1 to 255. */
    timeoutExitCode?: number;
    log?: Logger;
    proc?: {
        on(sig: "SIGINT" | "SIGTERM", fn: () => void): void;
        exit(code: number): void;
        stderr: {
            write(s: string): void;
        };
    };
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
}
/**
 * Registers SIGINT and SIGTERM before `start`, reports a startup failure (exit 2 for a
 * `StartupError`, 1 otherwise) and stops within `timeoutMs` on a signal. Resolves when `start`
 * has settled.
 */
export declare function runService(opts: RunServiceOptions): Promise<void>;
