/**
 * The largest delay in ms that `setTimeout` accepts (2^31 - 1). Node fires a timer with a
 * larger delay after 1 ms instead, so a longer wait must be capped or split.
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
/** Like `setTimeout`, but throws a RangeError instead of firing early for an invalid delay. */
export function safeSetTimeout(fn, ms, setTimeoutImpl = setTimeout) {
    if (!Number.isInteger(ms) || ms < 0 || ms > MAX_TIMER_DELAY_MS) {
        throw new RangeError("timer delay must be an integer from 0 to 2147483647 ms");
    }
    return setTimeoutImpl(fn, ms);
}
