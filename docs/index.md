# pulse-kit documentation

pulse-kit holds the shared runtime helpers of the pulse services, so probe, api, status and notify
handle settings, shutdown, health, metrics and logs the same way. For how the services fit together,
see the [architecture](https://github.com/lorenzh/pulse-meta/blob/main/docs/architecture.md) in the
meta repository. The main README is [README.md](../README.md).

## Exports

Everything is a named export of the package root `@lorenzh/pulse-kit`. The browser-safe modules
`format-duration`, `escape` and `is-record` also import as `@lorenzh/pulse-kit/format-duration`,
`@lorenzh/pulse-kit/escape` and `@lorenzh/pulse-kit/is-record`; they import nothing from Node. The kit has no runtime dependency.

### Settings (`settings.ts`)

Unset or blank gives the fallback. An invalid value throws `StartupError` with `setting` set and the
message `"<NAME>: <rule>"`; the message never contains the raw value. Every reader accepts
`describe` in its options to replace `<rule>`.

| Export                                                                                                          | Behavior                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `class StartupError extends Error`                                                                              | `name` is `"StartupError"`; `setting: string \| undefined`; `new StartupError(message, { setting?, cause? })`. The only startup and config error class of the services.                                                                                                                                                                               |
| `type Env`                                                                                                      | `Readonly<Record<string, string \| undefined>>`                                                                                                                                                                                                                                                                                                       |
| `readMs(env, name, { fallback, min, max?, describe? }): number`                                                 | Delay in ms for a timer. Integer from `min` to `max`, default and upper bound `2147483647` (`MAX_TIMER_DELAY_MS`); a larger value is rejected, never clamped. Rule: `must be an integer from <min> to <max>`. An explicit `max` above `2147483647` or a `fallback` that is not an integer in `[min, max]` throws `RangeError` before the env is read. |
| `readInt(env, name, { fallback, min, max?, describe? }): number`                                                | Integer without a timer bound (counts, days); default max `Number.MAX_SAFE_INTEGER`. Rule: `must be an integer >= <min>`, or `must be an integer from <min> to <max>` when `max` is set.                                                                                                                                                              |
| `readPort(env, name, { fallback?, min?, describe? }?): number \| undefined`                                     | Integer 0..65535. Rule: `must be an integer from <min> to 65535`.                                                                                                                                                                                                                                                                                     |
| `readUrl(env, name, { protocols?, allowCredentials?, allowQueryOrFragment?, describe? }?): string \| undefined` | Default protocols `http:` and `https:`. Returns the href without a trailing `/`. Rule: `must be an http(s) URL without credentials, query or fragment`.                                                                                                                                                                                               |
| `readEnum(env, name, values, fallback, { describe? }?): T`                                                      | Rule: `must be one of a, b`.                                                                                                                                                                                                                                                                                                                          |
| `readBool(env, name, fallback, { describe? }?): boolean`                                                        | `true`, `false`, `1`, `0`. Rule: `must be true, false, 1 or 0`.                                                                                                                                                                                                                                                                                       |
| `readString(env, name): string \| undefined`                                                                    | Trimmed; blank is `undefined`.                                                                                                                                                                                                                                                                                                                        |

### Logger (`logger.ts`)

| Export                                            | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOG_LEVELS`, `type LogLevel`                     | `debug`, `info`, `warn`, `error`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `type LogFields`, `interface Logger`              | `debug/info/warn/error(msg, fields?)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `createLogger({ level?, now?, write? }?): Logger` | Writes one JSON line: `time` (ISO), `level`, `msg`, then the fields in their order; a field never overrides `time`, `level` or `msg`. Never throws: a BigInt is written as its decimal string (`10n` → `"10"`), an object that is its own ancestor as `"[Circular]"` (a repeated non-cyclic reference is written in full), a field that cannot be serialized (throwing getter or `toJSON`, too deep) as `"[Unserializable]"`, fields that cannot be enumerated as `"fields":"[Unserializable]"`, a throwing or invalid `now` as `"time":null`; a throwing `write` is ignored. Fallbacks never contain the error text or the value. `undefined`, functions and symbols are dropped. Default `write`: warn and error to stderr, others to stdout, plus `\n`. `write` gets the line without newline. |
| `readLogLevel(env): LogLevel`                     | `PULSE_LOG_LEVEL`, default `info`; error `PULSE_LOG_LEVEL: must be one of debug, info, warn, error`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Service run (`run-service.ts`)

`runService({ service, start, stop, timeoutMs, timeoutExitCode?, log?, proc?, setTimeout?, clearTimeout? }): Promise<void>`

Registers SIGINT and SIGTERM before `start`. A signal while `start` runs waits for it to settle,
then stops. `start` throwing `StartupError` writes `pulse-<service>: <message>` to stderr and exits
2; another throw logs `startup failed` (or writes a stderr line without a logger) and exits 1. On a
signal it logs `shutting down` with `{ signal }`, runs `stop` and exits 0. If `stop` takes longer
than `timeoutMs`, it logs a warning `shutdown did not finish within <timeoutMs>ms; exiting anyway`
and exits with `timeoutExitCode` (default 1; an integer from 1 to 255). `timeoutMs` must be an
integer from 1 to 2147483647. An invalid `timeoutMs` or `timeoutExitCode` rejects the promise with
`RangeError` before any signal handler is registered and before `start` runs. `stop` throwing exits 1. A second signal does
nothing. The promise resolves when `start` has settled.

### Atomic write (`atomic-write.ts`)

Root export only, not browser-safe.

`writeFileAtomicSync(path, data, { mode?, tempSuffix?, fs?, beforeRename? }?): boolean` and
`writeFileAtomic(...)` (async, same options; `beforeRename` may return a promise) replace a file
in these steps:

1. `stat(path)`. A missing file is a new file.
2. Create the temp file `<path>.<suffix>.tmp` in the same directory with `wx` (exclusive). The
   default suffix is `<pid>-<12 hex>`. The mode is the existing file's mode, else `mode` (default
   `0o600`).
3. Write all bytes, `fchmod`, copy the owner of an existing file (`EPERM` is ignored), `fsync`,
   `close`.
4. `beforeRename()`: `false` removes the temp file and returns `false`; a throw removes it and
   rethrows the same error.
5. `rename` onto `path`, then `fsync` the directory. Returns `true`.

A failure throws `AtomicWriteError` with `stage` `"write"`, `"rename"` or `"sync-dir"`, `code` (the
Node error code, or `undefined`) and `cause`. The message is `atomic write failed at <stage>` plus
` (<code>)`; it never holds the path or the data. Before the rename the destination keeps its old
bytes and the temp file is removed. A temp file that `wx` could not create is never removed. After
`"sync-dir"` the new bytes are already in place. `nodeAtomicWriteSyncFs` and `nodeAtomicWriteFs`
are the default `node:fs` implementations of `AtomicWriteSyncFs` and `AtomicWriteFs`.

### Ops server (`ops-server.ts`)

| Export                                                                      | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type Readiness`                                                            | `{ ready: true } \| { ready: false; reason: string }`                                                                                                                                                                                                                                                                                                                                                                                        |
| `interface OpsHandlers`                                                     | `live?`, `ready`, `metrics`, `allowHead?` (default false), `methodNotAllowed?: "404" \| "405"` (default `"405"`).                                                                                                                                                                                                                                                                                                                            |
| `handleOps(req, res, handlers): boolean`                                    | Serves `/healthz` (from `live`, default always ready), `/readyz` and `/metrics`. Returns false for other paths so the caller continues. A not-ready state answers 503 with `<reason>\n`; otherwise 200 `ok\n`. Plain responses have `content-type: text/plain`; `/metrics` has `content-type: text/plain; version=0.0.4; charset=utf-8`. A method other than GET (and HEAD when allowed) answers 405 or 404. A throwing handler answers 500. |
| `startOpsServer({ ...handlers, host, port, setting? }): Promise<OpsServer>` | Own listener; other paths answer 404 `not found\n`. A bind failure (`EADDRINUSE`, `EACCES`, `EADDRNOTAVAIL`) rejects with `StartupError` naming `setting`.                                                                                                                                                                                                                                                                                   |
| `interface OpsServer`                                                       | `{ port: number; close(): Promise<void> }`; `close` also closes open connections.                                                                                                                                                                                                                                                                                                                                                            |

### Metrics (`metrics.ts`)

| Export                          | Behavior                                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DURATION_BUCKETS_SECONDS`      | `[0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`                                                                                                                                 |
| `createRegistry(): Registry`    | `counter(name, help)`, `gauge(name, help)`, `histogram(name, help, buckets?)`, `collect(fn)` (runs before each render) and `render()`. Registering a name twice throws. |
| `Counter`, `Gauge`, `Histogram` | `inc(labels?, by?)`, `set(value, labels?)`, `observe(value, labels?)`; each has `remove(match)`, which deletes series that contain every pair of `match`.               |

`render()` prints metrics in registration order: `# HELP`, `# TYPE`, then series in insertion order
with labels as given and values escaped by `escapeLabel`. Histograms print `_bucket` lines with
`le`, `le="+Inf"`, `_sum` and `_count`. A metric without series still prints HELP and TYPE. Numbers
print as `String(n)`. The output ends with one `\n`.

### Format and escape (browser-safe)

| Export                       | Behavior                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `formatDuration(ms): string` | Whole minutes, at most two of days, hours, minutes: `<1m`, `12m`, `3h 5m`, `3h`, `1d 2h`, `2d`. Negative or NaN counts as 0. Uses `Intl.DurationFormat` with a hand-built fallback of the same strings. |
| `escapeHtml(s)`              | `& < > " '` become `&amp; &lt; &gt; &quot; &#39;`.                                                                                                                                                      |
| `escapeLabel(s)`             | Prometheus label value: `\` to `\\`, `"` to `\"`, newline to `\n`.                                                                                                                                      |

### HTTP and timer

| Export                                              | Behavior                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `sendJson(res, status, body, headers?)`             | `content-type: application/json` and `content-length`.                             |
| `readBody(req, maxBytes): Promise<string>`          | Rejects with `BodyError` `too-large` (413) over the limit, or `aborted` (400).     |
| `readJsonBody(req, { maxBytes }): Promise<unknown>` | As `readBody`, then parses; `BodyError` `invalid-json` (400).                      |
| `class BodyError extends Error`                     | `status: 400 \| 413`, `code: "too-large" \| "invalid-json" \| "aborted"`.          |
| `MAX_TIMER_DELAY_MS`                                | `2_147_483_647`, the largest delay `setTimeout` accepts.                           |
| `safeSetTimeout(fn, ms, setTimeoutImpl?)`           | Throws `RangeError` for NaN, negative, non-integer or too large `ms`; no clamping. |

### Helpers

- `isRecord(value): value is Record<string, unknown>`: `typeof value === "object"`, not `null`,
  not an array. A null-prototype object and a `Date` are `true`. Also at the browser-safe subpath
  `@lorenzh/pulse-kit/is-record`.
- `readSecretFile(path, { setting, readFile? }): string`: reads the file (default UTF-8), trims it
  and returns the one line. Errors are `StartupError` with `setting`:
  `<setting>=<path>: cannot read (<CODE>)` (the code only when it matches `E[A-Z0-9]+`),
  `<setting>=<path>: file is empty`, `<setting>=<path>: must hold one line`. The message never
  holds the content or the raw fs message.

## Pin it in a consumer

Consumers are pulse-probe, pulse-api, pulse-status, pulse-notify and pulse-console. Each pins the kit to a full
commit SHA on its `main`, exactly like pulse-contract.

1. Merge the kit change to `main` of pulse-kit and note the full commit SHA.
2. In the consumer, set the dependency in `package.json`:
   `"@lorenzh/pulse-kit": "github:lorenzh/pulse-kit#<full commit sha>"`.
3. Run `bun install` to update `bun.lock`.
4. Run `bun run check` and fix any errors.
5. Commit `package.json` and `bun.lock` together.
