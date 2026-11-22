# tctcl-platform

Monorepo for the tctcl platform: a Node/TypeScript backend, a React frontend
and a long-running agent process, sharing TypeScript and lint configuration.

> **Status: early scaffold.** The repository currently contains build tooling,
> shared configuration and runnable app skeletons. There are no product
> features yet — every app is a placeholder (a hello-world agent, a `GET /health`
> endpoint and the unmodified Vite starter screen). Nothing is designed here
> that later code should treat as stable API.

## Requirements

- Node.js `26.13.1` (see `.node-version`)
- pnpm `12.16.1` (pinned via `packageManager` in `package.json`)

## Getting started

```bash
pnpm install      # installs all workspaces and the git hooks
pnpm dev          # runs every app's dev task through turbo
pnpm build        # builds every workspace
pnpm typecheck    # type-checks every workspace
pnpm lint         # lints every workspace
pnpm test         # runs the Vitest suites
```

Run a single app instead of everything:

```bash
pnpm dev:agent
pnpm dev:backend
pnpm dev:frontend
```

## Workspaces

| Path | Package name | Purpose |
| --- | --- | --- |
| `apps/agent` | `@tctcl/agent` | Long-running agent process (placeholder entry point) |
| `apps/backend` | `backend` | Fastify HTTP service (`GET /health`) |
| `apps/frontend` | `frontend` | React + Vite web client (starter screen) |
| `packages/typescript-config` | `@tctcl/typescript-config` | Shared `tsconfig` presets |
| `packages/oxlint-config` | `@tctcl/oxlint-config` | Shared oxlint presets |
| `packages/vitest-config` | `@tctcl/vitest-config` | Shared Vitest presets |

`pnpm-workspace.yaml` includes `apps/*` and `packages/*`; turbo orchestrates the
`build`, `dev`, `typecheck`, `lint` and `test` tasks defined in `turbo.json`.

## Root scripts

| Script | Command |
| --- | --- |
| `dev` | `turbo run dev` |
| `dev:agent` | `turbo run dev --filter=@tctcl/agent` |
| `dev:backend` | `turbo run dev --filter=backend` |
| `dev:frontend` | `turbo run dev --filter=frontend` |
| `build` | `turbo run build` |
| `typecheck` | `turbo run typecheck` |
| `lint` | `turbo run lint` |
| `test` | `turbo run test` |
| `prepare` | `husky` (runs on `pnpm install`, installs the commit-msg hook) |

## Repository layout

```text
.github/         CI workflows, issue and pull request templates, Dependabot
apps/            runnable applications (see each app's README)
packages/        shared configuration consumed by the apps
docs/            cross-cutting notes (architecture, data flow, decisions)
infrastructure/  deployment and infrastructure assets (empty for now)
```

## Shared configuration

Apps do not define TypeScript or lint settings inline; they extend the packages
in `packages/` so a change lands everywhere at once.

- `@tctcl/typescript-config` provides `base.json`, `typescript.json`,
  `fastify.json` and `vite.json`.
- `@tctcl/oxlint-config` provides `base.json` (Node/TypeScript) and `react.json`
  (adds React and browser environments).
- `@tctcl/vitest-config` provides `base` (Node environment) and `react` (jsdom
  plus Testing Library setup).

## Testing

Vitest runs in every app; `pnpm test` executes all suites through turbo.

```bash
pnpm test                         # every workspace
pnpm --filter backend test        # one workspace
pnpm --filter frontend test:watch # watch mode
```

Tests are colocated with the code they cover (`src/**/*.test.ts[x]`) and import
`describe`, `it` and `expect` from `vitest` — globals are off. Node packages run
in the Node environment; `apps/frontend` runs in jsdom with Testing Library and
`@testing-library/jest-dom` matchers. There is no coverage provider installed
yet.

## Versioning and releases

The repository uses [Semantic Versioning](https://semver.org/) with a single
version for every workspace, and releases are automated so nobody has to
remember bumping a version or writing a changelog:

- Every change lands on `main` as a Conventional Commit (squash merge); the pull
  request title is validated in CI and commit messages are validated locally.
- [release-please](https://github.com/googleapis/release-please) keeps an open
  release pull request that bumps the version everywhere and writes
  `CHANGELOG.md` from those commits.
- Merging that pull request tags `vX.Y.Z` and publishes the GitHub Release.

There is no `dev` or `staging` branch: this is trunk-based, and stability is
carried by tags (and, later, by deployments), not by long-lived branches. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full flow.

## Getting help

- **Questions and ideas** — GitHub Discussions.
- **Bugs and feature requests** — the issue templates.
- **Security problems** — privately, per [SECURITY.md](SECURITY.md). Never a
  public issue.
- **Anything else** — open an issue and say so.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [AGENTS.md](AGENTS.md)
for the coding style, conventions and non-negotiables. All participation is
covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

In short: branch from `main`, keep the change scoped to one workspace where
possible, write a Conventional Commit pull request title, run
`pnpm typecheck && pnpm lint && pnpm test && pnpm build` before opening it, and
update the relevant README when you add a script, workspace or environment
variable.

## License

MIT — see [LICENSE](LICENSE). Copyright 2026 Luke Hohlin (tctcl).
