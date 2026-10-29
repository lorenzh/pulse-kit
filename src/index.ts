/**
 * The largest delay in ms that `setTimeout` accepts (2^31 - 1). Node fires a timer with a
 * larger delay after 1 ms instead, so a longer wait must be capped or split.
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
