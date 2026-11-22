# @tctcl/agent

Long-running agent process for the tctcl platform.

**Status: placeholder.** `src/index.ts` currently just logs `Hello, World!`. The
process shape (message loop, transport, model access) is not designed yet, so
treat this package as an empty shell to fill in.

## Scripts

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `pnpm run build && pnpm run start` | compiles then runs `dist/index.js` once |
| `build` | `tsc -p tsconfig.json` | emits to `dist/` |
| `start` | `node dist/index.js` | requires a prior build |
| `typecheck` | `tsc -p tsconfig.test.json` | type-checks source and tests, no emit |
| `lint` | `oxlint` | shared config from `@tctcl/oxlint-config/base.json` |
| `test` | `vitest run` | one-shot run, CI friendly |
| `test:watch` | `vitest` | watch mode |

There is no watch mode or hot reload for this package yet.

## Configuration

- TypeScript: extends `@tctcl/typescript-config/typescript.json`, sources in
  `src/`, output in `dist/`. `tsconfig.json` excludes `*.test.ts` from the build;
  `tsconfig.test.json` re-includes them for the no-emit typecheck.
- Lint: `.oxlintrc.json` extends `../../packages/oxlint-config/base.json`.
- Tests: `vitest.config.ts` extends `@tctcl/vitest-config/base`. Colocated
  `src/**/*.test.ts` files, Node environment, no globals.
- Environment variables: none.

## Running from the repo root

```bash
pnpm dev:agent
```
