import { readEnum } from "./settings.js";
export const LOG_LEVELS = ["debug", "info", "warn", "error"];
const BASE_KEYS = new Set(["time", "level", "msg"]);
function writeToStream(level, line) {
    if (level === "warn" || level === "error")
        process.stderr.write(`${line}\n`);
    else
        process.stdout.write(`${line}\n`);
}
/** PULSE_LOG_LEVEL, default info. */
export function readLogLevel(env) {
    return readEnum(env, "PULSE_LOG_LEVEL", LOG_LEVELS, "info");
}
export function createLogger(opts = {}) {
    const threshold = LOG_LEVELS.indexOf(opts.level ?? "info");
    const now = opts.now ?? Date.now;
    const write = opts.write ?? writeToStream;
    const emit = (level, msg, fields = {}) => {
        if (LOG_LEVELS.indexOf(level) < threshold)
            return;
        const line = { time: new Date(now()).toISOString(), level, msg };
        for (const [key, value] of Object.entries(fields)) {
            // A field never overrides time, level or msg.
            if (!BASE_KEYS.has(key))
                line[key] = value;
        }
        write(level, JSON.stringify(line));
    };
    return {
        debug: (msg, fields) => emit("debug", msg, fields),
        info: (msg, fields) => emit("info", msg, fields),
        warn: (msg, fields) => emit("warn", msg, fields),
        error: (msg, fields) => emit("error", msg, fields),
    };
}
