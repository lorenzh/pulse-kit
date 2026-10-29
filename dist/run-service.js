import { StartupError } from "./settings.js";
function messageOf(err) {
    return err instanceof Error ? err.message : String(err);
}
/**
 * Registers SIGINT and SIGTERM before `start`, reports a startup failure (exit 2 for a
 * `StartupError`, 1 otherwise) and stops within `timeoutMs` on a signal. Resolves when `start`
 * has settled.
 */
export async function runService(opts) {
    const proc = opts.proc ?? process;
    const setTimer = opts.setTimeout ?? setTimeout;
    const clearTimer = opts.clearTimeout ?? clearTimeout;
    const prefix = `pulse-${opts.service}`;
    let hasSignal = false;
    const fail = (msg, err, code) => {
        if (opts.log === undefined)
            proc.stderr.write(`${prefix}: ${msg}: ${messageOf(err)}\n`);
        else
            opts.log.error(msg, { error: messageOf(err) });
        proc.exit(code);
    };
    const stopOnSignal = async (signal) => {
        opts.log?.info("shutting down", { signal });
        let isDone = false;
        const timer = setTimer(() => {
            if (isDone)
                return;
            isDone = true;
            opts.log?.warn(`shutdown did not finish within ${opts.timeoutMs}ms; exiting anyway`, {
                timeoutMs: opts.timeoutMs,
            });
            proc.exit(opts.timeoutExitCode ?? 0);
        }, opts.timeoutMs);
        try {
            await opts.stop(signal);
            if (isDone)
                return;
            isDone = true;
            clearTimer(timer);
            proc.exit(0);
        }
        catch (err) {
            if (isDone)
                return;
            isDone = true;
            clearTimer(timer);
            fail("shutdown failed", err, 1);
        }
    };
    // Handlers are registered before `start` runs; they only read `startSettled` when a signal fires.
    let startSettled = Promise.resolve(false);
    const onSignal = (signal) => {
        if (hasSignal)
            return;
        hasSignal = true;
        void startSettled.then((isStarted) => (isStarted ? stopOnSignal(signal) : undefined));
    };
    proc.on("SIGINT", () => onSignal("SIGINT"));
    proc.on("SIGTERM", () => onSignal("SIGTERM"));
    startSettled = (async () => {
        try {
            await opts.start();
            return true;
        }
        catch (err) {
            if (err instanceof StartupError) {
                proc.stderr.write(`${prefix}: ${err.message}\n`);
                proc.exit(2);
            }
            else {
                fail("startup failed", err, 1);
            }
            return false;
        }
    })();
    await startSettled;
}
