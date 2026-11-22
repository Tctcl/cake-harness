# AGENTS.md

Instructions for anyone — human or AI agent — working in this repository.

This file describes how the codebase is expected to be built, not what has been
built. Most of it is currently aspirational for a scaffold that has no product
features yet; treat it as the constraint set that new code must satisfy from day
one, so conventions do not have to be retrofitted later.

## The project

`tctcl-platform` is a pnpm + turbo monorepo for a Node/TypeScript backend, a
React frontend and a long-running agent process, plus shared TypeScript and lint
configuration. It is MIT licensed and intended to be developed in public.

**Current state:** scaffolding only. `apps/agent` prints `Hello, World!`,
`apps/backend` serves `GET /ping`, `apps/frontend` is the stock Vite starter
screen, `docs/` and `infrastructure/` are empty. Do not describe these as
features anywhere, and do not assume an API here is stable.

## Non-negotiables

1. **Never commit secrets.** `.env*` files, API keys, tokens and connection
   strings stay out of Git. `.pi/agent/` is machine-local state (it holds
   credentials) and is ignored — never un-ignore it.
2. **Never hand-edit `pnpm-lock.yaml`.** Add or remove dependencies with `pnpm`
   and let the lockfile regenerate.
3. **Never weaken `strict`.** No `as any`, no `@ts-ignore`, no `@ts-expect-error`
   without a comment explaining the upstream bug that forces it. No
   `// oxlint-disable` without the same.
4. **No new dependency for something the standard library or an installed
   dependency already does.** Dependencies are a maintenance contract; a helper
   function is usually cheaper.
5. **Configuration is shared, not per-app.** TypeScript comes from
   `@tctcl/typescript-config`, lint from `@tctcl/oxlint-config`, tests from
   `@tctcl/vitest-config`. An app's
   `tsconfig.json` / `.oxlintrc.json` should stay a few lines of `extends`
   plus genuinely app-specific options.
6. **`pnpm typecheck && pnpm lint && pnpm test && pnpm build` must pass before
   any commit.** `.github/workflows/gates.yml` runs the same four commands as the
   required `gates` check; there is no other automated gate (no SAST, no secret
   scanning, no coverage threshold).

## Repository map

```text
apps/agent        @tctcl/agent        Node ESM process, emits dist/ via tsc
apps/backend      backend            Fastify service, tsx in dev, tsc build
apps/frontend     frontend           React 19 + Vite 8, vite build
packages/typescript-config           shared tsconfig presets (JSON only)
packages/oxlint-config               shared oxlint presets (JSON only)
packages/vitest-config               shared Vitest presets (base + react)
docs/                                cross-cutting notes (architecture, ADRs)
infrastructure/                       deployment assets (empty for now)
.github/workflows/                   gates, commits (PR title), release
.github/ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE.md, dependabot.yml
CONTRIBUTING.md                      workflow, commit convention, releases
CODE_OF_CONDUCT.md                   Contributor Covenant 3.0
SECURITY.md                          private vulnerability reporting
release-please-config.json           version bumps + changelog automation
.release-please-manifest.json        last released version per package
commitlint.config.mjs                local Conventional Commit validation
```

Runtime: Node `26.13.1`, pnpm `12.16.1`. Both are pinned; do not bump one without
the other.

## Commands

```bash
pnpm install                       # after any package.json change
pnpm dev                           # all apps (turbo, persistent)
pnpm dev:backend                   # one app
pnpm build
pnpm typecheck
pnpm lint
pnpm test                          # vitest run in every app
pnpm --filter <pkg> <script>       # single workspace
```

Nothing else is a gate. `pnpm dev` and `test:watch` never exit — never run them
in CI or in a verification step.

## TypeScript style

- ESM only. `"type": "module"`, `verbatimModuleSyntax` is on: use
  `import type { Foo } from '...'` for type-only imports.
- Import with the Node protocol for builtins: `node:fs`, `node:path`.
- Prefer `const`; `let` only for genuine reassignment; `var` is linted out.
- `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are
  enabled in the shared configs. Write code that survives them — index access
  is `T | undefined`, optional properties cannot be set to `undefined`
  explicitly.
- No non-null assertions (`!`) to silence the compiler. Narrow properly.
- Prefer `unknown` over `any` at boundaries, then validate and narrow.
- Type inference wins where it is obvious (`const count = 0`), explicit types win
  at module boundaries (exported function signatures, public types).
- One concept per file. File names are kebab-case except React components
  (`App.tsx`), and match the primary export.
- Named exports only, except where a tool demands a default (`vite.config.ts`,
  app entry points that frameworks expect).

## Code philosophy

- **Smallest change that solves the problem.** Do not refactor adjacent code
  while fixing a bug, and do not add abstractions in anticipation of needs that
  do not exist yet. A second use case earns the abstraction; the first does not.
- **Explicit over clever.** Readable failure beats clever success. If a line
  needs a comment to be understood, either rewrite it or write the comment.
- **Fail loudly at the edges, trust inside.** Validate input where it enters the
  process (HTTP handler, CLI argument, env var). Internal functions may assume
  validated data because the types say so.
- **Errors are part of the API.** Never swallow an error with an empty `catch`.
  If a failure is expected, handle it and record why; if it is not, let it
  propagate.
- **No speculative configurability.** Hardcode until there is a second caller.
  When configuration arrives, read it once at startup and validate it.
- **Comments explain why, not what.** `// Retry once: the provider drops the
  first connection after idle` is useful. `// increment i` is noise.
- **Dead code is deleted, not commented out.** Git remembers.
- **Docs move with code.** Adding a script, workspace or env var means updating
  the matching README in the same change.

## Backend rules (`apps/backend`)

- Route registration lives in `src/server.ts` behind `buildServer()`;
  `src/index.ts` only reads configuration and calls `listen()`. Anything that
  binds a port stays out of the importable module so tests can inject requests.
- Fastify plugins and route modules over a single growing `server.ts`.
- Route handlers return typed payloads; schema validation is preferred to
  manual casting once routes carry input.
- Never read `process.env` scattered through the code — there will be one config
  module once configuration exists.
- Host and port are currently hardcoded (`127.0.0.1:8080`); move them to config
  when the service needs to run anywhere but a laptop.

## Frontend rules (`apps/frontend`)

- Function components with hooks only. No class components.
- Keep state as local as possible; lift only when two siblings genuinely share it.
- `App.tsx` is a placeholder — replace it rather than extending it.
- CSS lives next to the component it styles, or globally in `src/index.css`.
  No new styling framework without an explicit decision recorded in `docs/`.
- Import assets so Vite fingerprints them; nothing goes into `public/` unless it
  must keep a stable path.

## Agent process rules (`apps/agent`)

- It is a long-running process: never block the event loop with synchronous
  work that can grow with input.
- Log through one logger, not bare `console.log`, as soon as it does real work.
- Treat every external call as failing: timeouts, retries, backoff.

## Git and commits

- Conventional Commits: `feat(backend): add health endpoint`,
  `fix(frontend): correct counter reset`, `docs: describe the agent lifecycle`,
  `chore: bump turbo`. Scope is the workspace, not the file.
- One logical change per commit. Formatting churn does not ride along with a
  behavioural change.
- Never commit build output (`dist/`, `.turbo/`), `node_modules/` or
  `*.tsbuildinfo`; they are ignored — keep them ignored.
- Do not rewrite published history or force-push shared branches.

## Branches and releases

- Trunk-based: `main` is the only long-lived branch. Short-lived branches are
  prefixed `feat/`, `fix/`, `docs/`, `chore/`, `refactor/` and merged by squash,
  so the pull request title becomes the commit on `main`.
- There is no `dev` or `staging` branch. Do not create one without an explicit
  decision recorded in `docs/`.
- Never bump a version or hand-write a changelog entry. `release-please` derives
  both from the commits: `CHANGELOG.md`, every `package.json` version and the
  `vX.Y.Z` tag are maintained by `.github/workflows/release.yml`.
- One version for the whole repository. A version bump that touches only some
  workspaces is a bug in the automation, not a manual fix.
- Before `1.0.0`, a breaking change bumps the minor version
  (`bump-minor-pre-major`). Do not tag `1.0.0` without an explicit decision.

## Working with AI agents

- Read the file before editing it. Do not guess at contents.
- Say what changed and what you verified. "It should work" is not verification.
- Report problems you find but were not asked to fix, then stop. Do not expand
  scope.
- Ask before adding a dependency, a new workspace, a test framework, or a
  linter/formatter.
- Never commit, push or deploy without being asked.

## Testing

Vitest is installed in every app and runs through `@tctcl/vitest-config`.

- Colocate tests: `src/**/*.test.ts` (Node packages) or `src/**/*.test.tsx`
  (React). No `__tests__` directories, no separate `test/` trees outside
  `apps/frontend/src/test/setup.ts`.
- Globals are off. Import `describe`, `it`, `expect`, `vi` from `vitest`.
- `apps/backend`: exercise routes with `server.inject()`, never by opening a
  port. Close the instance in `finally`.
- `apps/frontend`: Testing Library only, query by role/text, no snapshot tests
  of the starter screen. Cleanup is handled in `src/test/setup.ts`.
- Unit tests for pure logic, integration tests for routes and components. Do not
  mock the module under test.
- Build and typecheck use different configs: `tsconfig.json` excludes test files
  from `dist/`, `tsconfig.test.json` type-checks them (`pnpm typecheck`).
- No coverage provider is installed. Do not claim coverage numbers, and do not
  add `@vitest/coverage-v8` without deciding on a threshold first.
- A new app must add `test` and `test:watch` scripts plus a `vitest.config.ts`
  that extends the shared preset.

## License and contributions

MIT (see `LICENSE`). Copyright 2026 Luke Hohlin (tctcl). By contributing, you
agree your contribution is licensed under the same terms.
