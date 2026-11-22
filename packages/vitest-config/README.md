# @tctcl/vitest-config

Shared [Vitest](https://vitest.dev) presets for this monorepo. The `vitest`
binary lives in each app's `devDependencies`; this package only ships the
configuration so every app runs tests the same way.

There are no scripts in this package and nothing to build.

## Presets

| Export | Environment | Setup | Used by |
| --- | --- | --- | --- |
| `@tctcl/vitest-config/base` | `node` | none | `apps/agent`, `apps/backend` |
| `@tctcl/vitest-config/react` | `jsdom` | `@vitejs/plugin-react`, `./src/test/setup.ts` | `apps/frontend` |

Both presets share:

- `include: ['src/**/*.test.{ts,tsx}']` — tests are colocated with the code.
- `globals: false` (Vitest's default) — import `describe`, `it` and `expect`
  from `vitest` in every test file.
- `restoreMocks` and `clearMocks` — spies do not leak between tests.
- `passWithNoTests: false` — a suite that runs zero tests fails the gate.

## Usage

```ts
// apps/backend/vitest.config.ts
import base from '@tctcl/vitest-config/base'

export default base
```

```ts
// apps/frontend/vitest.config.ts
import react from '@tctcl/vitest-config/react'

export default react
```

The React preset expects the app to provide `src/test/setup.ts`. Because Vitest
globals are off, Testing Library does **not** clean up automatically — the setup
file registers it:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

## Commands

```bash
pnpm test                          # all apps, one-shot (CI)
pnpm --filter backend test:watch   # watch mode for one app
```

## Editing

- Node-only change → `base.ts`; DOM/React change → `react.ts`.
- Keep app-specific config in the app's `vitest.config.ts` by merging the preset
  with `mergeConfig` rather than adding options here that only one app needs.
- Verify with `pnpm test` from the repo root.
