# @tctcl/typescript-config

Shared `tsconfig` presets for this monorepo. Every app and package extends one
of these instead of duplicating compiler options, so a flag change here applies
across the repo on the next `pnpm typecheck` / `pnpm build`.

There is no code in this package, only JSON. It has no scripts and is not
compiled on its own.

## Presets

| Export | Extends | Used by | Notes |
| --- | --- | --- | --- |
| `@tctcl/typescript-config/base.json` | — | nothing directly | `strict`, `ES2022` target, `NodeNext`-agnostic base options |
| `@tctcl/typescript-config/typescript.json` | `base.json` | `apps/agent` | Node ESM: `NodeNext` module/resolution, declarations, source maps |
| `@tctcl/typescript-config/fastify.json` | `typescript.json` | `apps/backend` | Node ESM plus server-oriented strictness (`noUnusedLocals`, `exactOptionalPropertyTypes`, `noImplicitReturns`) |
| `@tctcl/typescript-config/vite.json` | `base.json` | `apps/frontend` | Browser/bundler: `ESNext` modules, `Bundler` resolution, `react-jsx`, `noEmit`, DOM libs |

## Usage

```json
{
  "extends": "@tctcl/typescript-config/typescript.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

Add the package as a workspace dev dependency first:

```json
{ "devDependencies": { "@tctcl/typescript-config": "workspace:*" } }
```

## Editing

- Change shared strictness in `base.json` — everything inherits it.
- Prefer a new preset over overrides in an app's `tsconfig.json` when more than
  one app needs the same option.
- Verify with `pnpm typecheck && pnpm build` from the repo root after a change.
