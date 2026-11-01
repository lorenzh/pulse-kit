/** True for any non-null, non-array object, also one with a null prototype. Browser-safe. */
export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
