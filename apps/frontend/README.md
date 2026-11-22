# frontend

React + Vite web client for the tctcl platform.

**Status: layout shell.** One screen: a sidebar, a top bar and a prompt box that
posts to the backend's `/chat` and shows the answer in an `alert()`. It is the
first end-to-end exercise of the durable chat route (see
[`docs/durable.md`](../../docs/durable.md)), not product UI — every component
here is a placeholder.

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
- `@` resolves to `src/` (alias in `vite.config.ts` and `tsconfig.json`).
- Styling: Tailwind CSS v4 through `@tailwindcss/vite` — no `tailwind.config.js`;
  theme tokens live in `src/index.css`. Components follow the shadcn/ui
  "new-york" preset recorded in `components.json`, so new primitives are added
  with the shadcn CLI rather than hand-written. Dependencies: React 19,
  `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`,
  `lucide-react`, `tw-animate-css`.
- Dev proxy: `vite.config.ts` forwards `/chat` to `http://127.0.0.1:8080`, so the
  page reaches the backend without CORS. Start `pnpm dev:backend` alongside
  `pnpm dev:frontend` or the prompt box fails.
- Environment variables: none defined. Vite only exposes variables prefixed with
  `VITE_`, and only when they are present in a `.env*` file at this package root.

## Layout

```text
index.html              Vite entry document
vite.config.ts          React, Tailwind, `@` alias and the `/chat` dev proxy
components.json         shadcn/ui preset (style, base colour, aliases)
src/main.tsx            React root (StrictMode)
src/App.tsx             the screen: sidebar, top bar, prompt box
src/components/layout/  sidebar.tsx, top-nav.tsx
src/components/ui/      button.tsx (shadcn/ui primitive)
src/lib/utils.ts        `cn()` — clsx + tailwind-merge
src/index.css           Tailwind entry and theme tokens
src/App.test.tsx        smoke tests for the screen
src/test/setup.ts       Testing Library setup (jest-dom matchers, cleanup)
```
