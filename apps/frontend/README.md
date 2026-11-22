# frontend

React + Vite web client for the tctcl platform.

**Status: starter screen.** The app is the unmodified Vite + React template —
a counter and the framework logos. There is no routing, no data fetching and no
product UI yet; replace `src/App.tsx` when real screens land.

## Scripts

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `vite` | dev server with HMR |
| `build` | `tsc -b && vite build` | type-checks the project references, then bundles to `dist/` |
| `preview` | `vite preview` | serves the built `dist/` locally |
| `typecheck` | `tsc -p tsconfig.json --noEmit` | no emit |
| `lint` | `oxlint` | shared config from `@tctcl/oxlint-config/react.json` |
| `test` | `vitest run` | jsdom + Testing Library, one-shot run |
| `test:watch` | `vitest` | watch mode |

## Running

```bash
pnpm dev:frontend         # from the repo root
# or
pnpm --filter frontend dev
```

Vite prints the local URL (default `http://localhost:5173`).

## Configuration

- TypeScript: extends `@tctcl/typescript-config/vite.json`; build info is kept in
  `node_modules/.tmp/tsconfig.tsbuildinfo`.
- Lint: `.oxlintrc.json` extends `../../packages/oxlint-config/react.json`
  (React rules, browser environment).
- Tests: `vitest.config.ts` extends `@tctcl/vitest-config/react` (jsdom,
  Testing Library, jest-dom matchers, and a setup file that unmounts between
  tests). Test files are `src/**/*.test.tsx`.
- Environment variables: none defined. Vite only exposes variables prefixed with
  `VITE_`, and only when they are present in a `.env*` file at this package root.

## Layout

```text
index.html        Vite entry document
vite.config.ts    Vite + @vitejs/plugin-react setup
src/main.tsx      React root (StrictMode)
src/App.tsx       starter component — replace this
src/App.test.tsx  smoke tests for the starter screen
src/test/setup.ts Testing Library setup (jest-dom matchers, cleanup)
src/assets/       images and logos used by the starter screen
public/           static files served as-is
```
