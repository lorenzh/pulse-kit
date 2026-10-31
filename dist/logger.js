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
const UNSERIALIZABLE = '"[Unserializable]"';
/** JSON for one field value: BigInt as decimal string, a cycle as "[Circular]". */
function serializeValue(value) {
    // Objects on the path from the root to the current value; a repeat off this path is no cycle.
    const ancestors = [];
    return JSON.stringify(value, function (_key, v) {
        if (typeof v === "bigint")
            return v.toString();
        if (typeof v !== "object" || v === null)
            return v;
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this)
            ancestors.pop();
        if (ancestors.includes(v))
            return "[Circular]";
        ancestors.push(v);
        return v;
    });
}
function serializeField(value) {
    try {
        return serializeValue(value);
    }
    catch {
        // The thrown text may carry the value, so only a fixed marker is written.
        return UNSERIALIZABLE;
    }
}
function fieldParts(fields) {
    let entries;
    try {
        entries = Object.entries(fields);
    }
    catch {
        // The fields object itself cannot be enumerated, e.g. a Proxy with a throwing ownKeys.
        return `,"fields":${UNSERIALIZABLE}`;
    }
    let out = "";
    for (const [key, value] of entries) {
        // A field never overrides time, level or msg.
        if (BASE_KEYS.has(key))
            continue;
        const json = serializeField(value);
        if (json !== undefined)
            out += `,${JSON.stringify(key)}:${json}`;
    }
    return out;
}
function timeOf(now) {
    try {
        return new Date(now()).toISOString();
    }
    catch {
        // A throwing clock or an invalid date gives "time":null instead of a lost line.
        return null;
    }
}
export function createLogger(opts = {}) {
    const threshold = LOG_LEVELS.indexOf(opts.level ?? "info");
    const now = opts.now ?? Date.now;
    const write = opts.write ?? writeToStream;
    const emit = (level, msg, fields = {}) => {
        if (LOG_LEVELS.indexOf(level) < threshold)
            return;
        const base = `{"time":${JSON.stringify(timeOf(now))},"level":${JSON.stringify(level)},"msg":${JSON.stringify(String(msg))}`;
        const line = `${base}${fieldParts(fields)}}`;
        try {
            write(level, line);
        }
        catch {
            // Logging must never throw; there is nowhere left to report a failed write.
        }
    };
    return {
        debug: (msg, fields) => emit("debug", msg, fields),
        info: (msg, fields) => emit("info", msg, fields),
        warn: (msg, fields) => emit("warn", msg, fields),
        error: (msg, fields) => emit("error", msg, fields),
    };
}
