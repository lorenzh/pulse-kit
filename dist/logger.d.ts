import { type Env } from "./settings.ts";
export declare const LOG_LEVELS: readonly ["debug", "info", "warn", "error"];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;
export interface Logger {
    debug(msg: string, fields?: LogFields): void;
    info(msg: string, fields?: LogFields): void;
    warn(msg: string, fields?: LogFields): void;
    error(msg: string, fields?: LogFields): void;
}
export interface LoggerOptions {
    level?: LogLevel;
    now?: () => number;
    /** Receives the JSON line without a newline. Default: warn and error to stderr, others to stdout. */
    write?: (level: LogLevel, line: string) => void;
}
/** PULSE_LOG_LEVEL, default info. */
export declare function readLogLevel(env: Env): LogLevel;
export declare function createLogger(opts?: LoggerOptions): Logger;
