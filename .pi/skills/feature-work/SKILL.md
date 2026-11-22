---
name: feature-work
description: End-to-end feature and change workflow for this turbo/pnpm monorepo — intake, read existing docs and neighbouring code, plan the smallest change, implement, verify with typecheck/build/lint, sync docs, hand off. Use when implementing a feature, changing behavior, or adding a workspace.
---

# Feature work

Scope is permission: do what was asked and nothing more. If the request is
ambiguous, ask instead of assuming. If you find a larger problem, report it —
do not fix it unsolicited.

## Phase 0 — Intake

Restate the request in one or two lines: the scope, the expected outcome, and the
stopping condition. Ask before proceeding if any of these is unknown:

- which workspace(s) are in scope (`apps/agent`, `apps/backend`, `apps/frontend`, `packages/typescript-config`);
- whether a new dependency is allowed (never add one without asking);
- whether a new workspace/app is expected.

## Phase 1 — Read before writing

1. `AGENTS.md` (repo invariants), then the root `README.md`.
2. The target workspace's `README.md` and `package.json` (scripts, deps, entry point).
3. Any relevant `docs/*.md`.
4. The nearest existing example of the pattern you are about to write — grep for
   it and follow that file's structure, naming, and error handling. Do not
   introduce a second way of doing something that already exists.

Established facts (verified, do not re-litigate): Node `v26.13.1`,
pnpm `12.16.1`, turbo `2.11.13`; `backend` = Fastify `^5.12.8` + `tsx`;
`frontend` = React `19.3.1` + Vite `8.3.6` + `oxlint`; `agent` = plain `tsc`;
`@tctcl/typescript-config` provides shared tsconfig bases.

## Phase 2 — Plan

Smallest change that achieves the outcome. State it as a short list of files and
why each moves. Check dependency direction: apps may depend on `packages/*`,
never the reverse. No refactors outside the requested scope, no new
abstractions, no new dependencies, no renames "while here".

## Phase 3 — Implement

- Match neighbouring code style exactly; do not reformat untouched lines.
- Keep types honest — no `as any`, no `@ts-ignore` to get past the gate. Fix the
  type or ask.
- Errors: follow the existing error handling of that workspace rather than
  inventing a new pattern.
- Comments only where the code cannot explain itself; no narrating comments.

## Phase 4 — Verify

```bash
pnpm typecheck                       # all workspaces
pnpm build                           # all workspaces
pnpm lint                            # frontend only today
pnpm typecheck --filter=<workspace>  # narrow loop while iterating
```

Quote failures with the exact file:line. If a failure is pre-existing and
unrelated, say so explicitly and leave it alone. No test runner exists — propose
adding one only if asked.

## Phase 5 — Docs sync

If behavior, commands, env vars, or structure changed, update the matching
README (root or workspace) and add a `docs/` note when the reasoning is
cross-cutting. Do not write docs for changes that need none.

## Phase 6 — Handoff

Report: files changed (paths), verification results, what remains open, and a
suggested Conventional Commit message. Stop when the stopping condition is met.
