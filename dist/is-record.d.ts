/** True for any non-null, non-array object, also one with a null prototype. Browser-safe. */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
