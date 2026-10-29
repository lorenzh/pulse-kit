export declare const DURATION_BUCKETS_SECONDS: readonly [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
export type Labels = Readonly<Record<string, string>>;
export interface Counter {
    inc(labels?: Labels, by?: number): void;
    remove(match: Labels): void;
}
export interface Gauge {
    set(value: number, labels?: Labels): void;
    remove(match: Labels): void;
}
export interface Histogram {
    observe(value: number, labels?: Labels): void;
    remove(match: Labels): void;
}
export interface Registry {
    counter(name: string, help: string): Counter;
    gauge(name: string, help: string): Gauge;
    histogram(name: string, help: string, buckets?: readonly number[]): Histogram;
    /** Runs before every render, to set gauges from live state. */
    collect(fn: () => void): void;
    render(): string;
}
export declare function createRegistry(): Registry;
