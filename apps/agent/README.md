# @cake-harness/agent

The workspace environment: a container image that boots a machine wired for a
single workspace, and the bootstrap that reconciles that machine against the
desired tooling the backend serves.

**Status: first slice.** The bootstrap reads the desired tooling and credential
documents, reports what is actually installed, plans the work, and materialises
the credentials. It does not install anything yet, and the agent message loop
does not exist. See `docs/remote-development.md` for the design and
`docs/deferred.md` for what is deliberately postponed.

## Scripts

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `pnpm run build && pnpm run start` | compiles then runs `dist/index.js` once |
| `build` | `tsc -p tsconfig.json` | emits to `dist/` |
| `start` | `node dist/index.js` | requires a prior build, plus the config documents |
| `typecheck` | `tsc -p tsconfig.test.json` | type-checks source and tests, no emit |
| `lint` | `oxlint` | shared config from `@cake-harness/oxlint-config/base.json` |
| `test` | `vitest run` | one-shot run, CI friendly |
| `test:watch` | `vitest` | watch mode |

## The bootstrap

`src/index.ts` is what runs inside the container as its init step:

1. Fetch the environment's manifest from `DEV_ENV_MANIFEST_URL`, served by the
   backend at `GET /environments/:id/manifest`, and validate both documents in it.
   A malformed document fails the boot — a machine that starts half-configured is
   worse than one that refuses to start.
2. Detect what is installed (`src/tooling/detect.ts`) and report it. A tool named
   in `DEV_ENV_INSTALL_RECORD` is reported as `installed`, everything else as
   `image`.
3. Diff desired against actual (`src/tooling/plan.ts`): `install`, `replace`,
   `keep`, `extra`. Installing is not implemented; the plan is the output.
4. Materialise credentials (`src/credentials/apply.ts`) as `0600` files for the
   development user, never into the bootstrap's own environment.
5. Send the actual state to `DEV_ENV_STATE_URL` (`src/report.ts`). A backend that
   refuses the report is logged, not thrown: the environment works either way.

Everything is logged as JSON lines by `src/log.ts`; no log line carries a
credential value, only ids.

## Layout

```text
src/index.ts              bootstrap entry point
src/config.ts             reads and validates the three environment variables
src/documents.ts          fetches the manifest and validates both documents
src/report.ts             sends the actual state back to the backend
src/log.ts                the only logger
src/tooling/contract.ts   desired tooling, actual tooling
src/tooling/parse.ts      runtime validation of the desired document
src/tooling/detect.ts     version detection table + probes
src/tooling/record.ts     what reconciliation installed, keyed by tool id
src/tooling/plan.ts       pure reconcile plan
src/credentials/contract.ts  credential document, env map + files
src/credentials/parse.ts     runtime validation
src/credentials/apply.ts     writes env file and credential files
docker/entrypoint.sh      host keys, authorized keys, bootstrap, then sshd as PID 1
docker/sshd_config        public key only, root login off
Dockerfile                universal development image
compose.dev.yml           local harness: build, run, port 2222
```

## Configuration

- TypeScript: extends `@cake-harness/typescript-config/typescript.json`, sources in
  `src/`, output in `dist/`. `tsconfig.json` excludes `*.test.ts` from the build;
  `tsconfig.test.json` re-includes them for the no-emit typecheck.
- Lint: `.oxlintrc.json` extends `../../packages/oxlint-config/base.json`.
- Tests: `vitest.config.ts` extends `@cake-harness/vitest-config/base`. Colocated
  `src/**/*.test.ts` files, Node environment, no globals.
- Environment variables: `DEV_ENV_MANIFEST_URL` (required — the backend's
  manifest for this environment), `DEV_ENV_STATE_URL` (where the report goes;
  absent means the environment runs without telling anyone), and
  `DEV_ENV_INSTALL_RECORD` (default `/var/lib/dev-env/installed.json`).
  `SSH_AUTHORIZED_KEYS_FILE` is read by `docker/entrypoint.sh`, not by the
  bootstrap.

## Running from the repo root

```bash
pnpm dev:agent
```

That is the container's dev task: it compiles the bootstrap and runs
`docker compose -f compose.dev.yml up --build`. The process is not meant to run on
the host — it creates the `dev` user, installs into `/var/lib/dev-env` and reads a
manifest that only exists inside the stack — so the dev task starts the container
that has those things. Docker is required, and so are the SSH keys below.

Root `pnpm dev` deliberately does not include it. An app that starts a container
the backend has not created is not a peer of the two host processes, and putting
it in the default loop would put an environment the backend cannot see, or stop,
on port 2222 every time. The managed path — the backend creating the container and
injecting its manifest URL — is exercised in the stack under `deploy/`.

## Running the container

Keys are per machine and are not committed; generate them once. Then build the
bootstrap, build the image and start it:

```bash
cd apps/agent
ssh-keygen -q -t ed25519 -N '' -f dev/ssh/id_ed25519
pnpm build
docker compose -f compose.dev.yml up --build
ssh -i dev/ssh/id_ed25519 -p 2222 -o StrictHostKeyChecking=no dev@127.0.0.1
```

`docker compose logs` shows the bootstrap's JSON lines. There is no backend in
this harness, so the log opens with `entrypoint.no_manifest_url` and sshd starts
with the image's floor of tooling; set `DEV_ENV_MANIFEST_URL` to a served manifest
to exercise the rest. The port is published on `127.0.0.1` only; do not widen it
while authorization is still a single key.
