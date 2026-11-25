---
name: precommit
description: Verify this repo is ready to commit and to be public — runs the typecheck/build/lint/test gates, checks the open-source documentation set (LICENSE, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, .github templates), audits docs for staleness, and scans for secrets and machine-local files. Use when asked whether the repo is ready to commit, before committing, or when reviewing uncommitted changes.
---

# Precommit check

Verify the repo is ready to commit **and** ready to be public. The
documentation expectations below follow the [Open Source Guides](https://opensource.guide)
pre-launch checklist (`starting-a-project`, `how-to-contribute`,
`security-best-practices-for-your-project`, `best-practices`): license, README,
contributing guidelines and code of conduct are the minimum; a security policy,
issue/PR templates and automation come next.

Run every phase and report a verdict per gate. **Never** run `git add`,
`git commit`, `git push`, or `git stash` unless explicitly asked — this skill
verifies, it does not commit.

## Phase 0 — Scope

```bash
git status --short
git diff --stat          # unstaged
git diff --cached --stat # staged
git log --oneline -5     # note "fatal: ... does not have any commits yet"
```

State which workspaces changed. If there are no commits yet, say so: everything
is untracked, the first commit is a public release candidate, and Phase 3 must
also consider history (there is none yet) and repo naming.

## Phase 1 — Gates

Run from the repo root. Turbo fans out to workspaces; a failure anywhere fails
the run.

| Gate | Command | Notes |
| --- | --- | --- |
| Types | `pnpm typecheck` | `tsc -p tsconfig.test.json` for `agent`/`backend` (source + tests), `tsc -p tsconfig.json --noEmit` for `frontend` |
| Lint | `pnpm lint` | oxlint in all three apps via `@cake-harness/oxlint-config`; `packages/*` have no lint script |
| Tests | `pnpm test` | `vitest run` in all three apps via `@cake-harness/vitest-config`; frontend uses jsdom + Testing Library |
| Build | `pnpm build` | `tsc` for `agent`/`backend`, `tsc -b && vite build` for `frontend` |

Report each as PASS / FAIL / SKIP with the exact error and `file:line`. Fix only
if asked, then re-run that one gate.

Do not claim coverage: no coverage provider is installed. Do not run watch mode
(`test:watch`) — it never exits.

## Phase 2 — Open-source documentation register

All paths are repo-root relative. A file that is **0 bytes counts as missing**.

### Required (blocking)

| File | Must contain |
| --- | --- |
| `LICENSE` | Real license text (MIT), holder line `Copyright (c) <year> Luke Hohlin (tctcl)`, linked from README. GitHub must be able to auto-detect it |
| `README.md` | What the project is; why it is useful; how to get started; where to get help; honest **status** (currently "early scaffold — no product features"); prerequisites (Node `v26.13.1` per `.node-version`, pnpm `12.16.1`); `pnpm install`; workspace table (`apps/agent`, `apps/backend`, `apps/frontend`, `packages/typescript-config`, `packages/oxlint-config`, `packages/vitest-config`) matching `pnpm-workspace.yaml`; root scripts (`dev`, `dev:agent`, `dev:backend`, `dev:frontend`, `build`, `typecheck`, `lint`, `test`); testing section; license section |
| `CONTRIBUTING.md` | How to report a bug / request a feature (point at the issue templates); local setup (`pnpm install`, Node/pnpm versions); how to run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; commit convention (Conventional Commits, workspace scope); PR expectations (one logical change, docs updated); what kinds of contributions are wanted. Must be linked from `README.md` |
| `CODE_OF_CONDUCT.md` | Adopted standard (Contributor Covenant), scope (issues, PRs, discussions), enforcement + **how to report a violation** with a real contact address, consequences. Linked from `README.md` or `CONTRIBUTING.md` |

### Expected for a public project (blocking once published)

| File | Must contain |
| --- | --- |
| `SECURITY.md` | Supported versions, **private** reporting channel (GitHub private vulnerability reporting and/or a real address — never "open a public issue"), what to expect and when, and a short triage/fix/disclose process |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Repro steps, expected vs actual, versions, environment |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Problem, proposed solution, alternatives |
| `.github/ISSUE_TEMPLATE/config.yml` | `blank_issues_enabled: false` and links to docs/security policy |
| `.github/PULL_REQUEST_TEMPLATE.md` | What changed, why, how it was verified, checklist (gates run, docs updated, no secrets) |
| `.github/dependabot.yml` | pnpm ecosystem, weekly, grouped updates (automates dependency security updates) |

### Repo knowledge (blocking)

| File | Must contain |
| --- | --- |
| `AGENTS.md` | Invariants for anyone (human or agent) working here: gates, style, philosophy, commit rules, testing rules, secrets rule |
| `docs/*.md` | Cross-cutting notes: architecture, data flow, infra, ADRs. `docs/` holding only `.gitkeep` is a gap to report |
| `apps/*/README.md`, `packages/*/README.md` | Purpose, status, scripts, config, env vars (say "none" explicitly) |

Also: `README.md` must answer "where do I get help?" — if there is no support
channel yet, say that explicitly rather than omitting the question.

### Staleness checks (treat any hit as blocking)

- Every command/path named in a README exists (`package.json` script, directory,
  file) and the documented command is the one actually defined.
- The workspace list matches the real directories and `pnpm-workspace.yaml`.
- No document describes an app, script, dependency, test runner or env var that
  no longer exists — and none omits one that does (e.g. a README saying "no test
  runner" while `pnpm test` exists).
- Documented ports/hosts/paths (`127.0.0.1:8080`, `<name>` grep) match the code.
- New app/package/script/env var added in this change → matching README updated
  in the same change.
- Links between documents resolve (`[AGENTS.md](AGENTS.md)`,
  `[LICENSE](LICENSE)`, CONTRIBUTING ↔ CODE_OF_CONDUCT ↔ SECURITY).

## Phase 3 — Repo hygiene

Blocking findings:

- **Secrets**, staged *or* untracked: `.env`, `.env.*`, `*.pem`, `*.key`, tokens,
  connection strings, private keys. `.gitignore` must contain `.env`, `.env.*`
  and `!.env.example`.
- **Machine-local Pi state**: `.pi/agent/` (credentials — `auth.json`,
  `mcp-auth.json`, `sessions/`), `.pi/profiles.backup/`,
  `.pi/npm/node_modules/` must be ignored and unstaged. Tracked parts are
  `.pi/settings.json`, `.pi/mcp.json`, `.pi/acp.json`, `.pi/APPEND_SYSTEM.md`,
  `.pi/skills/`, `.pi/prompts/`.
- **History scan before the first public push** (skip only when the repo has no
  commits): `git log --all -p | grep -nEi "(api[_-]?key|secret|password|token)\s*[:=]"`,
  plus `git log --all --diff-filter=A --name-only | sort -u` and confirm nothing
  sensitive was ever added. Also confirm no `.env*` file was committed and later
  deleted — deletion does not remove it from history.
- **Generated output ignored**: `dist/`, `.turbo/`, `node_modules/`,
  `*.tsbuildinfo`, `coverage/`. Confirm with `git status --short`.
- **Merge debris**: `*.orig`, `*.rej`, `.DS_Store`, stray `*.log`, editor swap
  files, empty stray directories (e.g. `.ignore/`).
- **Large binaries** (>1 MB) outside `node_modules/`, and lockfile churn beyond
  `pnpm-lock.yaml` (never hand-edited).
- **Formatting contract**: both `.gitattributes` (`* text=auto eol=lf`, binary
  rules, `pnpm-lock.yaml linguist-generated`) and `.editorconfig` exist. If Git
  prints "LF will be replaced by CRLF", `.gitattributes` is missing or wrong.
- **Dependency policy**: `pnpm-lock.yaml` changed together with the
  `package.json` files; no dependency added without it.
- **Release automation consistency** (all four must agree): root `package.json`
  `version`, `.release-please-manifest.json` `"."`, every
  `apps/*/package.json` and `packages/*/package.json` `version`, and the newest
  `vX.Y.Z` tag. A workspace left behind means `release-please-config.json`
  `extra-files` lost an entry.
- **Commit enforcement wired**: `commitlint.config.mjs` exists, the root
  `package.json` has `"prepare": "husky"` plus the three devDependencies, the
  `.husky/commit-msg` hook exists, and `git config core.hooksPath` is
  `.husky/_`. `.husky/_/` must never be committed (it carries its own
  `.gitignore` with `*`).
- **Workflow job names match the required checks**: `.github/workflows/gates.yml`
  defines job `gates`, `.github/workflows/commits.yml` defines job `commits`, and
  those are exactly the names documented in `CONTRIBUTING.md` as required.
  `.github/workflows/release.yml` must run on `push` to `main` with
  `contents: write` and `pull-requests: write`.

Report, don't silently fix. Recommend the exact `.gitignore` line when something
is unignored.

### Cannot be verified from files — remind, don't block

- GitHub repository description, topics, and social preview.
- Private vulnerability reporting enabled (Settings → Code security).
- Branch protection / required status checks on the default branch.
- Issue labels ("bug", "enhancement", "good first issue") and an organized queue.
- At least two admins, or a written note that this is a solo project.
- One-time name/trademark check (WIPO Global Brand Database, npm name
  availability) for `cake-harness` — do this once, note it in `docs/`, never re-check
  every commit.

## Phase 4 — Verdict

Output two tables:

1. `gate | result | detail` for typecheck / lint / test / build.
2. `artifact | present? | gap` for LICENSE, README, CONTRIBUTING,
   CODE_OF_CONDUCT, SECURITY, `.github/` templates, `dependabot.yml`, AGENTS.md,
   `docs/`, per-app READMEs.

Then one verdict:

- **READY** — all gates pass, required + expected documentation present and
  consistent, no hygiene findings.
- **READY WITH NOTES** — passes, but lists non-blocking gaps (missing
  `.github/` templates, empty `docs/`, no coverage provider, no SAST or secret
  scanning in CI, unpinned action versions, manual
  GitHub settings above).
- **NOT READY** — bullet each blocker with its file path and the fix.

Close with the GitHub settings that still need a human.

End with a suggested Conventional Commit message (`feat:`, `fix:`, `docs:`,
`chore:`, `refactor:`), scoped to the touched workspace, e.g.
`feat(backend): add ping route`.
