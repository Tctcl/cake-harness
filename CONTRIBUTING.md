# Contributing to tctcl-platform

Thanks for taking a look. This repository is currently an early scaffold — the
apps are placeholders — so it is a good moment to report a bug, ask a question
or suggest a direction before any of it becomes load-bearing.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Found a
security problem? **Do not open an issue** — read [SECURITY.md](SECURITY.md).

## Scope of a change

One logical change per pull request. Fixing a bug does not come with a refactor
of the adjacent code, and formatting churn does not ride along with a behavioural
change. If you find a problem you were not asked to fix, report it in an issue
instead of expanding the pull request.

## Setting up

Requirements are pinned: Node.js `26.13.1` (`.node-version`) and pnpm `12.16.1`
(the `packageManager` field). Node ships Corepack, so:

```bash
corepack enable
pnpm install      # installs every workspace and the git hooks
```

`pnpm install` runs the root `prepare` script, which installs the Husky hooks —
commit messages are linted locally from then on.

## Checks

Every pull request must pass the same four gates CI runs
(`.github/workflows/gates.yml`, required check `gates`):

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Run them from the repository root; turbo fans out to every workspace. A single
workspace works too: `pnpm --filter backend test`.

Formatting is not a gate: there is no formatter configured, and this repository
deliberately does not add one without an explicit decision.

## Branch model

This project uses **trunk-based development**: `main` is the only long-lived
branch. There is no `dev` and no `staging` branch — stability is expressed by
tags and deployments, not by branches.

```text
feat/short-lived-topic ──squash──► main ──► release PR ──► tag vX.Y.Z
```

1. Branch from `main` with a short-lived, prefixed name:
   `feat/…`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`.
2. Keep it alive for hours or days, not weeks. Merge early rather than keeping
   a branch in sync with `main` by hand.
3. Open a pull request. `main` requires two checks: `gates` and `commits`.
4. Merge with **squash**. The pull request title becomes the single commit on
   `main`, which is why it must be a valid Conventional Commit. Delete the branch.
5. `main` must always be releasable. Do not merge knowingly broken code; hide
   unfinished work behind a flag rather than parking it on a branch.

Direct pushes to `main` are reserved for the maintainer as an emergency bypass.
A `release/x.y` branch is only created if an already-released minor line still
needs a patch — branch it from the tag and cherry-pick. It is an escape hatch,
not part of the normal flow.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), always:

```text
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

- Subject in the imperative mood, lowercase, no trailing period, ≤ 100 characters
  for the whole header.
- Scope is the workspace or the concern. Use `agent`, `backend`, `frontend`,
  `typescript-config`, `oxlint-config`, `vitest-config`, `deps`, `ci`, `docs`
  or `repo`.
- A breaking change gets `!` before the colon (`feat(backend)!: …`) or a
  `BREAKING CHANGE:` footer. Before `1.0.0` it bumps the minor version.

| Type | Use for |
| --- | --- |
| `feat` | a new user-visible capability |
| `fix` | a bug fix |
| `perf` | a change that only improves speed or memory |
| `refactor` | restructuring without behaviour change |
| `docs` | documentation only |
| `test` | tests only |
| `build` | build tooling, bundler or TypeScript project config |
| `ci` | workflows, release automation |
| `chore` | maintenance, dependencies, housekeeping |
| `revert` | reverting an earlier commit |

Commitlint enforces this on every local commit (`commitlint.config.mjs`), and CI
enforces the pull request title, because squash merging makes that title the
commit.

## Pull requests

- Fill in [the template](.github/PULL_REQUEST_TEMPLATE.md): what changed, why,
  and how it was verified. "It should work" is not verification.
- Update documentation in the same change. Adding a script, workspace,
  environment variable or dependency means updating the matching README; the
  invariants live in [AGENTS.md](AGENTS.md).
- Never commit secrets. `.env`, `.env.*` and credentials are ignored — use
  `.env.example` for placeholders.
- Keep `pnpm-lock.yaml` generated. Add dependencies with `pnpm add`, never by
  hand-editing manifests.

## Releases

Versioning is [Semantic Versioning](https://semver.org/) with **one version for
the whole repository**: every workspace carries the same `version`, and `vX.Y.Z`
describes the monorepo at that commit.

Releases are automated with [release-please](https://github.com/googleapis/release-please)
(`.github/workflows/release.yml`, `release-please-config.json`):

1. Merge correctly-typed commits into `main`.
2. release-please keeps an open pull request titled `chore(main): release X.Y.Z`
   containing the version bumps and the updated `CHANGELOG.md`.
3. Merge that pull request. release-please tags the commit `vX.Y.Z` and
   publishes the GitHub Release with notes generated from the commits.

Nobody bumps a version or writes a changelog by hand. Two consequences worth
knowing:

- A commit that is not a Conventional Commit never reaches the changelog and
  never triggers a version bump. That is the whole reason for the local hook.
- The version in the release pull request is a starting point: it is yours to
  correct before merging if the automation guessed the wrong level.

Nothing is published to a registry yet; `apps/*` are private and `packages/*`
are internal presets. If that ever changes, it gets its own decision and its own
documentation.

## License

By contributing you agree that your contribution is licensed under the MIT
license — see [LICENSE](LICENSE). Copyright 2026 Luke Hohlin (tctcl).
