# backend

Fastify HTTP service for the tctcl platform.

**Status: placeholder.** `src/server.ts` exports `buildServer()` with a single
route, `GET /ping`, returning `pong`; `src/index.ts` starts it on
`127.0.0.1:8080`. There are no business routes, no data layer and no
configuration loading yet. The server factory exists so tests can inject
requests without binding a port.

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

The server binds `127.0.0.1:8080` (hardcoded):

```bash
curl http://127.0.0.1:8080/ping   # pong
```

## Testing

Routes are tested through Fastify's `inject()`, so no port is opened:

```ts
const server = buildServer()
const response = await server.inject({ method: 'GET', url: '/ping' })
```

## Configuration

- TypeScript: extends `@tctcl/typescript-config/fastify.json`, sources in
  `src/`, output in `dist/`. `tsconfig.json` excludes `*.test.ts` from the build;
  `tsconfig.test.json` re-includes them for the no-emit typecheck.
- Lint: `.oxlintrc.json` extends `../../packages/oxlint-config/base.json`.
- Tests: `vitest.config.ts` extends `@tctcl/vitest-config/base`.
- Environment variables: none. Host and port are literals in `src/index.ts`
  and will need to move to configuration once the service does anything.
