import type { Logger } from "./logger.ts";
import { StartupError } from "./settings.ts";

export interface RunServiceOptions {
  /** Service name, such as "probe". Prefixes startup error lines. */
  service: string;
  start: () => Promise<void>;
  /** Idempotent graceful stop. */
  stop: (signal: string) => Promise<void>;
  /** Bound on `stop`. */
  timeoutMs: number;
  /** Exit code when `stop` does not finish in time. Default 0. */
  timeoutExitCode?: number;
  log?: Logger;
  proc?: {
    on(sig: "SIGINT" | "SIGTERM", fn: () => void): void;
    exit(code: number): void;
    stderr: { write(s: string): void };
  };
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Registers SIGINT and SIGTERM before `start`, reports a startup failure (exit 2 for a
 * `StartupError`, 1 otherwise) and stops within `timeoutMs` on a signal. Resolves when `start`
 * has settled.
 */
export async function runService(opts: RunServiceOptions): Promise<void> {
  const proc = opts.proc ?? process;
  const setTimer = opts.setTimeout ?? setTimeout;
  const clearTimer = opts.clearTimeout ?? clearTimeout;
  const prefix = `pulse-${opts.service}`;
  let hasSignal = false;

  const fail = (msg: string, err: unknown, code: number): void => {
    if (opts.log === undefined) proc.stderr.write(`${prefix}: ${msg}: ${messageOf(err)}\n`);
    else opts.log.error(msg, { error: messageOf(err) });
    proc.exit(code);
  };

  const stopOnSignal = async (signal: string): Promise<void> => {
    opts.log?.info("shutting down", { signal });
    let isDone = false;
    const timer = setTimer(() => {
      if (isDone) return;
      isDone = true;
      opts.log?.warn(`shutdown did not finish within ${opts.timeoutMs}ms; exiting anyway`, {
        timeoutMs: opts.timeoutMs,
      });
      proc.exit(opts.timeoutExitCode ?? 0);
    }, opts.timeoutMs);
    try {
      await opts.stop(signal);
      if (isDone) return;
      isDone = true;
      clearTimer(timer);
      proc.exit(0);
    } catch (err) {
      if (isDone) return;
      isDone = true;
      clearTimer(timer);
      fail("shutdown failed", err, 1);
    }
  };

  // Handlers are registered before `start` runs; they only read `startSettled` when a signal fires.
  let startSettled: Promise<boolean> = Promise.resolve(false);
  const onSignal = (signal: "SIGINT" | "SIGTERM"): void => {
    if (hasSignal) return;
    hasSignal = true;
    void startSettled.then((isStarted) => (isStarted ? stopOnSignal(signal) : undefined));
  };
  proc.on("SIGINT", () => onSignal("SIGINT"));
  proc.on("SIGTERM", () => onSignal("SIGTERM"));

  startSettled = (async (): Promise<boolean> => {
    try {
      await opts.start();
      return true;
    } catch (err) {
      if (err instanceof StartupError) {
        proc.stderr.write(`${prefix}: ${err.message}\n`);
        proc.exit(2);
      } else {
        fail("startup failed", err, 1);
      }
      return false;
    }
  })();

  await startSettled;
}
