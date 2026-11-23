# @tctcl/agent

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
| `lint` | `oxlint` | shared config from `@tctcl/oxlint-config/base.json` |
| `test` | `vitest run` | one-shot run, CI friendly |
| `test:watch` | `vitest` | watch mode |

## The bootstrap

`src/index.ts` is what runs inside the container as its init step:

1. Read and validate `desired-tooling.json` and `credentials.json` from
   `DEV_ENV_CONFIG_DIR`. A malformed document fails the boot — a machine that
   starts half-configured is worse than one that refuses to start.
2. Detect what is installed (`src/tooling/detect.ts`) and report it.
3. Diff desired against actual (`src/tooling/plan.ts`): `install`, `replace`,
   `keep`, `extra`. Installing is not implemented; the plan is the output.
4. Materialise credentials (`src/credentials/apply.ts`) as `0600` files for the
   development user, never into the bootstrap's own environment.

Everything is logged as JSON lines by `src/log.ts`; no log line carries a
credential value, only ids.

## Layout

```text
src/index.ts              bootstrap entry point
src/config.ts             reads DEV_ENV_CONFIG_DIR, loads and validates a document
src/log.ts                the only logger
src/tooling/contract.ts   desired tooling, actual tooling
src/tooling/parse.ts      runtime validation of both documents
src/tooling/detect.ts     version detection table + probes
src/tooling/plan.ts       pure reconcile plan
src/credentials/contract.ts  credential document, env map + files
src/credentials/parse.ts     runtime validation
src/credentials/apply.ts     writes env file and credential files
docker/entrypoint.sh      host keys, authorized keys, bootstrap, then sshd as PID 1
docker/sshd_config        public key only, root login off
Dockerfile                universal development image
compose.dev.yml           local harness: build, run, port 2222
dev/*.json                dummy documents mounted in place of the backend
```

## Configuration

- TypeScript: extends `@tctcl/typescript-config/typescript.json`, sources in
  `src/`, output in `dist/`. `tsconfig.json` excludes `*.test.ts` from the build;
  `tsconfig.test.json` re-includes them for the no-emit typecheck.
- Lint: `.oxlintrc.json` extends `../../packages/oxlint-config/base.json`.
- Tests: `vitest.config.ts` extends `@tctcl/vitest-config/base`. Colocated
  `src/**/*.test.ts` files, Node environment, no globals.
- Environment variables: `DEV_ENV_CONFIG_DIR` (default `/etc/dev-env`) — where
  the bootstrap looks for its two documents. `SSH_AUTHORIZED_KEYS_FILE` is read by
  `docker/entrypoint.sh`, not by the bootstrap.

## Running from the repo root

```bash
pnpm dev:agent
```

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

`docker compose logs` shows the bootstrap's JSON lines. The port is published on
`127.0.0.1` only; do not widen it while authorization is still a single key.
