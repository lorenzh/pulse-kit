import { readFileSync } from "node:fs";
import { StartupError } from "./settings.js";
function errorCode(err) {
    if (typeof err !== "object" || err === null)
        return undefined;
    // An own data property only, so no getter of the thrown value runs.
    let value;
    try {
        value = Object.getOwnPropertyDescriptor(err, "code")?.value;
    }
    catch {
        // A Proxy trap threw; treat the code as unknown so its text never escapes.
        return undefined;
    }
    return typeof value === "string" && /^E[A-Z0-9]+$/.test(value) ? value : undefined;
}
/**
 * Reads a one-line secret from a file, such as a token. Returns the trimmed text. Errors name
 * the setting and path, never the content or the raw fs message.
 */
export function readSecretFile(path, opts) {
    const { setting } = opts;
    const readFile = opts.readFile ?? ((p) => readFileSync(p, "utf8"));
    let raw;
    try {
        raw = readFile(path);
    }
    catch (cause) {
        const code = errorCode(cause);
        const suffix = code === undefined ? "" : ` (${code})`;
        throw new StartupError(`${setting}=${path}: cannot read${suffix}`, { setting, cause });
    }
    const text = raw.trim();
    if (text === "")
        throw new StartupError(`${setting}=${path}: file is empty`, { setting });
    if (/[\r\n]/.test(text)) {
        throw new StartupError(`${setting}=${path}: must hold one line`, { setting });
    }
    return text;
}
