# pulse-kit

[![CI](https://github.com/lorenzh/pulse-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/lorenzh/pulse-kit/actions/workflows/ci.yml)

pulse is an uptime monitor with a status page. This repository holds the shared runtime helpers of its services: env settings with bounds, signal handling and bounded shutdown, an ops HTTP server, a Prometheus metrics registry, one JSON logger and small HTTP and timer helpers. It is consumed by [pulse-probe](https://github.com/lorenzh/pulse-probe), [pulse-api](https://github.com/lorenzh/pulse-api), [pulse-status](https://github.com/lorenzh/pulse-status) and [pulse-notify](https://github.com/lorenzh/pulse-notify).

Documentation: [docs/index.md](docs/index.md).

pulse is built by Paragon Factory agents from the issues in [pulse-meta](https://github.com/lorenzh/pulse-meta).

Contributing: see [AGENTS.md](AGENTS.md).

## Usage

Depend on a pinned commit of `main`:

```json
"@lorenzh/pulse-kit": "github:lorenzh/pulse-kit#<full commit sha>"
```

```ts
import { createLogger, readLogLevel, runService } from "@lorenzh/pulse-kit";
import { formatDuration } from "@lorenzh/pulse-kit/format-duration"; // browser-safe subpaths: format-duration, escape
```

The compiled output in `dist/` is committed, because Node does not strip types under
`node_modules` and Git dependencies have no build step. After changing `src/`, run
`npm run build` and commit `dist/`. A test fails when `dist/` is out of date.

## Development

Requires Node >= 24.

```sh
npm ci
npm run check   # lint, build, typecheck and tests
npm run lint    # Biome and SonarJS (ESLint) check, changes nothing
npm run format  # Biome autofix (safe fixes only)
```

`npm ci` installs a Lefthook pre-commit hook that runs `biome check` on staged
`*.js`, `*.ts`, `*.json` and `*.jsonc` files and ESLint on staged `*.js` and `*.ts` files, and rejects the commit if they are
badly formatted or fail lint. Run `npm run format` to fix them.

## Shared tooling configuration

The shared tooling configuration lives in `lorenzh/pulse-config`. The pin is in `package.json` and in the `uses:` ref of `.github/workflows/ci.yml`; update both together.

There are no settings and no run step: this is a library.

Licensed under the MIT licence, see [LICENSE](LICENSE).
