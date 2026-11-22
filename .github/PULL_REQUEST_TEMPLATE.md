# What changed

<!-- One paragraph. Link the issue it closes: "Closes #12". -->

## Why

<!-- The problem this solves. Skip if it is obvious from the title. -->

## How it was verified

<!--
"pnpm typecheck && pnpm lint && pnpm test && pnpm build" passing is the floor.
Add what you did beyond that: manual checks, the command you ran, the input you
tried. "It should work" is not verification.
-->

## Checklist

- [ ] The pull request title is a Conventional Commit (`feat(backend): …`) — it becomes the commit on `main`
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passes locally
- [ ] Documentation updated in the same change (README, `AGENTS.md`, `docs/`) if a script, workspace, env var or dependency changed
- [ ] No secrets, credentials or `.env` files are included
- [ ] The change is one logical change; unrelated refactors are left out or split off
