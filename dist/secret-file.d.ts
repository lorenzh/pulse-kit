/**
 * Reads a one-line secret from a file, such as a token. Returns the trimmed text. Errors name
 * the setting and path, never the content or the raw fs message.
 */
export declare function readSecretFile(path: string, opts: {
    setting: string;
    readFile?: (path: string) => string;
}): string;
