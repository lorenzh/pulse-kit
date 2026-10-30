import { test } from "bun:test";
import assert from "node:assert/strict";
import { createRegistry, DURATION_BUCKETS_SECONDS } from "../src/metrics.ts";

test("bucket list", () => {
  assert.deepEqual([...DURATION_BUCKETS_SECONDS], [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
});

test("renders counter, gauge and empty metrics in registration order", () => {
  const r = createRegistry();
  const c = r.counter("c_total", "A counter.");
  const g = r.gauge("g", "A gauge.");
  r.gauge("empty", "Nothing.");
  c.inc({ a: 'x"y' });
  c.inc({ a: 'x"y' }, 2);
  g.set(1.5);
  g.set(2);
  assert.equal(
    r.render(),
    [
      "# HELP c_total A counter.",
      "# TYPE c_total counter",
      'c_total{a="x\\"y"} 3',
      "# HELP g A gauge.",
      "# TYPE g gauge",
      "g 2",
      "# HELP empty Nothing.",
      "# TYPE empty gauge",
      "",
    ].join("\n"),
  );
});

test("renders a histogram", () => {
  const r = createRegistry();
  const h = r.histogram("d", "Dur.", [1, 2]);
  h.observe(0.5, { k: "v" });
  h.observe(3, { k: "v" });
  assert.equal(
    r.render(),
    [
      "# HELP d Dur.",
      "# TYPE d histogram",
      'd_bucket{k="v",le="1"} 1',
      'd_bucket{k="v",le="2"} 1',
      'd_bucket{k="v",le="+Inf"} 2',
      'd_sum{k="v"} 3.5',
      'd_count{k="v"} 2',
      "",
    ].join("\n"),
  );
});

test("histogram uses the default buckets", () => {
  const r = createRegistry();
  r.histogram("d", "Dur.").observe(0.01);
  assert.match(r.render(), /d_bucket\{le="0\.05"\} 1\n.*le="0\.1"\} 1/);
  assert.match(r.render(), /d_bucket\{le="10"\} 1\nd_bucket\{le="\+Inf"\} 1/);
});

test("remove deletes series matching every pair", () => {
  const r = createRegistry();
  const g = r.gauge("g", "G.");
  const c = r.counter("c", "C.");
  const h = r.histogram("h", "H.", [1]);
  g.set(1, { id: "a", k: "x" });
  g.set(2, { id: "b", k: "x" });
  c.inc({ id: "a" });
  h.observe(1, { id: "a" });
  g.remove({ id: "a" });
  c.remove({ id: "a" });
  h.remove({ id: "a" });
  const out = r.render();
  assert.match(out, /g\{id="b",k="x"\} 2/);
  assert.doesNotMatch(out, /id="a"/);
});

test("collect runs before every render; duplicate names throw", () => {
  const r = createRegistry();
  const g = r.gauge("g", "G.");
  let n = 0;
  r.collect(() => g.set(++n));
  assert.match(r.render(), /g 1\n/);
  assert.match(r.render(), /g 2\n/);
  assert.throws(() => r.counter("g", "again"), /already registered/);
});
