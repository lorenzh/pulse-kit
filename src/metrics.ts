import { escapeLabel } from "./escape.ts";

export const DURATION_BUCKETS_SECONDS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

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

interface Series {
  labels: Labels;
  value: number;
  /** Histogram only: cumulative bucket counts, sum is `value`. */
  counts?: number[];
  count?: number;
}

interface Metric {
  name: string;
  help: string;
  type: "counter" | "gauge" | "histogram";
  buckets: readonly number[];
  series: Map<string, Series>;
}

function seriesKey(labels: Labels): string {
  return JSON.stringify(Object.entries(labels));
}

function formatLabels(labels: Labels, extra?: [string, string]): string {
  const pairs = Object.entries(labels);
  if (extra !== undefined) pairs.push(extra);
  if (pairs.length === 0) return "";
  const body = pairs.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",");
  return `{${body}}`;
}

function removeMatching(metric: Metric, match: Labels): void {
  const wanted = Object.entries(match);
  for (const [key, series] of metric.series) {
    if (wanted.every(([k, v]) => series.labels[k] === v)) metric.series.delete(key);
  }
}

function renderMetric(metric: Metric): string[] {
  const lines = [`# HELP ${metric.name} ${metric.help}`, `# TYPE ${metric.name} ${metric.type}`];
  for (const series of metric.series.values()) {
    if (metric.type !== "histogram") {
      lines.push(`${metric.name}${formatLabels(series.labels)} ${series.value}`);
      continue;
    }
    const counts = series.counts ?? [];
    metric.buckets.forEach((bound, i) => {
      const labels = formatLabels(series.labels, ["le", String(bound)]);
      lines.push(`${metric.name}_bucket${labels} ${counts[i] ?? 0}`);
    });
    lines.push(
      `${metric.name}_bucket${formatLabels(series.labels, ["le", "+Inf"])} ${series.count ?? 0}`,
      `${metric.name}_sum${formatLabels(series.labels)} ${series.value}`,
      `${metric.name}_count${formatLabels(series.labels)} ${series.count ?? 0}`,
    );
  }
  return lines;
}

export function createRegistry(): Registry {
  const metrics: Metric[] = [];
  const collectors: (() => void)[] = [];

  const register = (
    name: string,
    help: string,
    type: Metric["type"],
    buckets: readonly number[] = [],
  ): Metric => {
    if (metrics.some((m) => m.name === name)) {
      throw new Error(`metric ${name} is already registered`);
    }
    const metric: Metric = { name, help, type, buckets, series: new Map() };
    metrics.push(metric);
    return metric;
  };

  return {
    counter(name, help) {
      const metric = register(name, help, "counter");
      return {
        inc(labels = {}, by = 1) {
          const key = seriesKey(labels);
          const series = metric.series.get(key) ?? { labels, value: 0 };
          series.value += by;
          metric.series.set(key, series);
        },
        remove: (match) => removeMatching(metric, match),
      };
    },
    gauge(name, help) {
      const metric = register(name, help, "gauge");
      return {
        set(value, labels = {}) {
          const key = seriesKey(labels);
          const series = metric.series.get(key);
          if (series === undefined) metric.series.set(key, { labels, value });
          else series.value = value;
        },
        remove: (match) => removeMatching(metric, match),
      };
    },
    histogram(name, help, buckets = DURATION_BUCKETS_SECONDS) {
      const metric = register(name, help, "histogram", buckets);
      return {
        observe(value, labels = {}) {
          const key = seriesKey(labels);
          const series = metric.series.get(key) ?? {
            labels,
            value: 0,
            counts: buckets.map(() => 0),
            count: 0,
          };
          series.value += value;
          series.count = (series.count ?? 0) + 1;
          series.counts = (series.counts ?? []).map((n, i) =>
            value <= (buckets[i] ?? Number.POSITIVE_INFINITY) ? n + 1 : n,
          );
          metric.series.set(key, series);
        },
        remove: (match) => removeMatching(metric, match),
      };
    },
    collect(fn) {
      collectors.push(fn);
    },
    render() {
      for (const fn of collectors) fn();
      return `${metrics.flatMap(renderMetric).join("\n")}\n`;
    },
  };
}
