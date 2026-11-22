# backend

Fastify HTTP service for the tctcl platform.

**Status: foundation only.** The service boots from a validated environment,
logs through Fastify's logger, answers `GET /health`, and renders errors as
`{ error: { code, message } }`. There are no business routes and no data layer.

```text
src/index.ts          bootstrap: load config, open the agent, build, listen, close
src/server.ts         buildServer(config, { agent }) — the importable factory tests use
src/config.ts         zod schema for process.env, loadConfig(), ConfigError
src/errors.ts         AppError: statusCode + stable code for errors that cross HTTP
src/error-handler.ts  error and not-found handlers (registered on the root instance)
src/plugins/index.ts  single plugin registration point
src/routes/health.ts  GET /health
src/routes/chat.ts    POST /chat — one prompt in, one answer out
src/agent.ts          pi-durable harness and the model it runs
```

`buildServer()` takes an explicit `Config` and never reads `process.env`, so
tests can build any environment without touching the real one.

## Scripts

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `tsx watch src/index.ts` | watches `src/` for changes |
| `build` | `tsc -p tsconfig.json` | emits to `dist/` |
| `start` | `node dist/index.js` | requires a prior build |
| `typecheck` | `tsc -p tsconfig.test.json` | type-checks source and tests, no emit |
| `lint` | `oxlint` | shared config from `@tctcl/oxlint-config/base.json` |
| `test` | `vitest run` | one-shot run, CI friendly |
| `test:watch` | `vitest` | watch mode |

## Running

```bash
pnpm dev:backend          # from the repo root
# or
pnpm --filter backend dev
```

```bash
curl -s http://127.0.0.1:8080/health
# {"status":"ok","uptime":1.54,"timestamp":"2026-11-22T02:47:26.447Z"}
```

An invalid environment exits with status 1 before the port is bound and lists
every problem at once:

```text
Invalid environment configuration:
  - NODE_ENV: Invalid option: expected one of "development"|"test"|"production"
  - PORT: must be a number
```

`SIGINT` and `SIGTERM` close the server; there is no connection draining or
worker shutdown yet.

## Configuration

Environment variables, validated once at startup by `src/config.ts`:

| Variable | Values | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `development`, `test`, `production` | `development` | disables the logger in `test`, hides internal error messages in `production` |
| `HOST` | non-empty string | `127.0.0.1` | `listen()` host |
| `PORT` | integer 1–65535 | `8080` | `listen()` port |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` | `info` | Fastify logger level |

`process.loadEnvFile()` reads `apps/backend/.env` if it exists, so local
development needs no exports; elsewhere set the variables in the shell, compose
file or deployment environment. Anything not listed here is ignored, and a
missing `.env` is not an error.

Tool configuration:

- TypeScript: extends `@tctcl/typescript-config/fastify.json`, sources in
  `src/`, output in `dist/`. `tsconfig.json` excludes `*.test.ts` from the build;
  `tsconfig.test.json` re-includes them for the no-emit typecheck.
- Lint: `.oxlintrc.json` extends `../../packages/oxlint-config/base.json`.
- Tests: `vitest.config.ts` extends `@tctcl/vitest-config/base`.

## Agent

`src/agent.ts` opens a pi-durable `Harness` over `MemoryStorage` and keeps one
root conversation:

- provider `opencode-go` (from `@earendil-works/pi-ai`), model
  `deepseek-v4.1-flash`, thinking level `low`
- `OPENCODE_API_KEY` supplies the provider key; it is read by pi-ai, not by
  `src/config.ts`
- `MemoryStorage` keeps nothing across a restart — no `resume()`, no sessions

`POST /chat` takes `{ "message": "..." }` and answers `{ "reply": "..." }`. A
submission that settles as `unanswered` becomes a `502 AGENT_UNANSWERED`.

```bash
curl -s -X POST http://127.0.0.1:8080/chat   -H 'content-type: application/json'   -d '{"message":"Reply with exactly: pong"}'
# {"reply":"pong"}
```

## Errors

`registerErrorHandling()` is called on the root Fastify instance. Fastify error
handlers are encapsulated, so an error handler registered inside a plugin would
not cover routes registered by sibling plugins.

| Situation | Status | Body |
| --- | --- | --- |
| Unknown route | 404 | `{ "error": { "code": "NOT_FOUND", "message": "Route GET /x not found" } }` |
| `AppError` thrown | `error.statusCode` | `{ "error": { "code": error.code, "message": error.message } }` |
| Fastify schema rejection | 400 | `{ "error": { "code": "VALIDATION_ERROR", "message": ... } }` |
| Any other `Error` | 500 | `{ "error": { "code": "INTERNAL_ERROR", "message": "Internal server error" } }` |

In `development` and `test` the 500 body carries the original message; in
`production` it is the literal `Internal server error`.

## Adding a route

Write a `FastifyPluginAsync` next to `src/routes/health.ts`, then register it in
`src/plugins/index.ts`. Keep `src/server.ts` down to instance options plus the
single `registerPlugins()` call.

## Testing

Routes are tested through Fastify's `inject()`, so no port is opened:

```ts
const agent = { ask: async (input) => `echo: ${input}`, close: async () => {} }
const server = buildServer(loadConfig({ NODE_ENV: 'test' }), { agent })
const response = await server.inject({ method: 'GET', url: '/health' })
```

`NODE_ENV=test` disables the logger, so failing tests do not print request logs.
Routes take the `Agent` through `buildServer()` options, so no test touches a
provider or a harness.
