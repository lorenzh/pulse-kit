export type Env = Readonly<Record<string, string | undefined>>;
/** The only startup and config error class of the pulse services. */
export declare class StartupError extends Error {
    readonly setting: string | undefined;
    constructor(message: string, opts?: {
        setting?: string | undefined;
        cause?: unknown;
    });
}
interface Describe {
    /** Replaces the rule text of the error message. */
    describe?: string;
}
/** The trimmed value, or undefined when unset or blank. */
export declare function readString(env: Env, name: string): string | undefined;
export declare function readMs(env: Env, name: string, opts: {
    fallback: number;
    min: number;
    max?: number;
} & Describe): number;
export declare function readPort(env: Env, name: string, opts?: {
    fallback?: number;
    min?: number;
} & Describe): number | undefined;
export declare function readUrl(env: Env, name: string, opts?: {
    protocols?: readonly string[];
    allowCredentials?: boolean;
    allowQueryOrFragment?: boolean;
} & Describe): string | undefined;
export declare function readEnum<T extends string>(env: Env, name: string, values: readonly T[], fallback: T, opts?: Describe): T;
export declare function readBool(env: Env, name: string, fallback: boolean, opts?: Describe): boolean;
export {};
