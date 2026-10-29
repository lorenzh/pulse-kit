# pulse-kit documentation

pulse-kit holds the shared runtime helpers of the pulse services, so probe, api, status and notify
handle settings, shutdown, health, metrics and logs the same way. For how the services fit together,
see the [architecture](https://github.com/lorenzh/pulse-meta/blob/main/docs/architecture.md) in the
meta repository. The main README is [README.md](../README.md).

## Exports

| Export               | Meaning                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `MAX_TIMER_DELAY_MS` | `2_147_483_647`, the largest delay `setTimeout` accepts (2^31 - 1 ms). |

## Planned modules

All planned; none is implemented yet.

- Settings (planned): `readMs`, `readPort`, `readUrl`, `readEnum` read env values with bounds and throw one `StartupError`.
- Service run (planned): `runService` handles `SIGTERM` and `SIGINT` and shuts down within a bound.
- Ops server (planned): `startOpsServer` serves `/livez`, `/readyz` and `/metrics`.
- Metrics (planned): a Prometheus metrics registry and `escapeLabel`.
- Logger (planned): one JSON logger.
- HTTP helpers (planned): `sendJson` and `readJsonBody` with a size limit.
- Time helpers (planned): `formatDuration` on `Intl.DurationFormat` and a `setTimeout` guard against delays above `MAX_TIMER_DELAY_MS`.

## Pin it in a consumer

Consumers are pulse-probe, pulse-api, pulse-status and pulse-notify. Each pins the kit to a full
commit SHA on its `main`, exactly like pulse-contract.

1. Merge the kit change to `main` of pulse-kit and note the full commit SHA.
2. In the consumer, set the dependency in `package.json`:
   `"@lorenzh/pulse-kit": "github:lorenzh/pulse-kit#<full commit sha>"`.
3. Run `npm install` to update `package-lock.json`.
4. Run `npm run check` and fix any errors.
5. Commit `package.json` and `package-lock.json` together.
