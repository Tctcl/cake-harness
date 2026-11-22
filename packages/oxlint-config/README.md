# @tctcl/oxlint-config

Shared [oxlint](https://oxc.rs/docs/guide/usage/linter) presets for this
monorepo. The `oxlint` binary itself lives in each app's `devDependencies`; this
package only ships JSON so all apps lint against the same rules.

There are no scripts in this package and no JavaScript to compile.

## Presets

| Export | Plugins / environment | Used by |
| --- | --- | --- |
| `@tctcl/oxlint-config/base.json` | `typescript`, `oxc`, `unicorn`; Node + ES2024; `correctness` = error | `apps/agent`, `apps/backend` |
| `@tctcl/oxlint-config/react.json` | extends `base.json`; adds `react`, `jsx-a11y`; browser environment; React hooks and JSX rules | `apps/frontend` |

`base.json` also ignores `dist/**`, `node_modules/**` and `coverage/**`, and
turns off `no-console` since these apps log to stdout.

## Usage

Each app keeps a small `.oxlintrc.json` that only points at the shared preset:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "extends": ["../../packages/oxlint-config/base.json"]
}
```

The path is relative, not a package specifier: oxlint resolves every `extends`
entry as a file path, so `@tctcl/oxlint-config/base.json` would be treated as a
directory name and fail. The package is still declared as a workspace
dependency so turbo knows the app depends on it.

Run it through the workspace script:

```bash
pnpm lint                 # all apps
pnpm --filter backend lint
```

## Editing

- New repo-wide rule → `base.json`; React-only rule → `react.json`.
- Add an app override in that app's `.oxlintrc.json` rather than here if only one
  app needs it.
- Check the effect with `pnpm lint` from the repo root.
