# backend

Fastify HTTP service for the tctcl platform.

**Status: chat slice with workspaces.** The service boots from a validated environment, logs
through Fastify's logger, answers `GET /health`, signs people in, serves chat threads over a
pi-durable session in Postgres, files those threads under a workspace and an agent, and renders errors as
`{ error: { code, message } }`. Sign-in is a username and password behind a session cookie,
with an optional TOTP second factor; a role holds the permissions a route checks, and
ownership is row data rather than a permission ([`docs/auth.md`](../../docs/auth.md)).
`singleUser` keeps an install to the one seeded identity, which is the only case where a
request runs without signing in.

```text
src/index.ts          entry point: load config, open the agent, build, listen, close
src/bootstrap-admin.ts one-off: give the seeded owner a username and password, turn accounts on
src/server.ts         buildServer(config, { agent }) — the importable factory tests use
src/config.ts         zod schema for process.env, loadConfig(), ConfigError
src/errors.ts         AppError: statusCode + stable code for errors that cross HTTP
src/error-handler.ts  error and not-found handlers (registered on the root instance)
src/plugins/index.ts  single plugin registration point
src/routes/health.ts  GET /health
src/routes/auth.ts    /auth/login, /auth/logout, /auth/session and the second-factor check
src/routes/account.ts the signed-in person's own password and second factor
src/routes/roles.ts   GET /roles
src/routes/users.ts   /users: list, create, reset, re-role, disable
src/routes/settings.ts /settings, /settings/public, and the two switches on an install
src/routes/credentials.ts /credentials: list, create, delete
src/routes/terminals.ts the terminals of one environment, and the websocket that attaches to one
src/plugins/actor.ts  who is calling: the session cookie, the single-user fallback, the public routes
src/auth/             password hashing, TOTP, sessions, roles, permissions and the sealed secret box
src/credentials/      user_credentials rows: a name, a kind and a sealed value
src/secrets/          CipherGate: read a value by name, with a timeout and no fallback
src/terminal/         PTY sessions: spawn, size, replay, reap
src/routes/me.ts      GET /me, the identity the sessions belong to
src/routes/threads.ts /threads, /threads/:threadId/messages and /threads/:threadId/context
src/context-usage.ts  what a thread's next request is made of, in estimated tokens
src/routes/workspaces.ts /workspaces and /workspaces/:workspaceId/agents
src/routes/capabilities.ts /tools, /prompts, /skills, /workspaces/:workspaceId/mcp/servers and the grants of a workspace
                      or an agent
src/routes/providers.ts   /providers/logins, /providers/models and what each workspace may spend
src/agent.ts          harness, one conversation per thread, the model it runs
src/threads/          users/chat_threads rows: local-user bootstrap and repository
src/capabilities/     the catalogs (tools synced from the registry, prompts, skills, the MCP servers of a workspace), the
                      link tables that grant them, and the ceiling check
src/providers/        the OpenCode Go client, the model cache and the keys a workspace may spend
src/environments/     dev environment rows, the Docker runtime, the manifest a container reports
src/workspaces/       workspaces rows and the seeded defaults (fixed ids, `allow_all`, no container)
src/agents/           agents rows, the container ceiling no longer lives here
src/storage/postgres/ durable's `Storage` over Postgres, plus the schema history
```

### Capability storage

Migration 6 adds the catalogs and the links between them and a workspace or an agent.
`tools` is written only by `ToolRepository.sync()` from what the installed registry
extensions offer (a row is a pointer at code, so the UI cannot invent one); a tool
that stops being offered is archived, not deleted. `prompts` and `skills` are the
same three columns today (name, description, body) and share `TextRepository`, with
separate tables so a skill can grow without moving rows. `workspace_mcp_servers` says how to
reach a server, in which working directory and with which environment: a server
belongs to the workspace whose container runs it, so `cwd` and `env` describe that
container and nothing else. It stores no secret. `credential_id` names a row of
`user_credentials` (kind `mcp`), which is where the value lives and which is owned
by a user rather than by the workspace.

Grants live in `workspace_tools`, `workspace_prompts`, `workspace_skills` and the
matching `agent_*` tables. Every link is a foreign key, so a grant of a row that
does not exist is refused by the database. MCP servers are the exception: they are
not granted, because the workspace already owns them and a grant would only be a
list of its own rows. An agent selects among them with `agent_mcp_servers.mcp_server_id`,
and `createCapabilityApi().setAgentGrants()` refuses an id the agent's workspace
does not own and, through `WorkspaceMcpServerRepository.delete()`, refuses to delete
a server an agent still names.

Not wired yet: the harness still opens with the registry's default tool set. The
routes below write the links and `createCapabilityApi().setAgentGrants()` refuses a
grant the workspace does not reach, but nothing reads a grant when a conversation
starts, so a grant is a statement of intent a launch will honour later.

Migration 7 dropped the `text[]` columns (`workspaces.allowed_*`, `agents.tools`,
`mcp_servers`, `skills`) that used to hold the same information, so the link tables
are now the only place a capability selection lives. `workspaces.allow_all` and
`agents.allow_all` remain as the "everything, including what does not exist yet"
switch, and a workspace with `allow_all` grants without enumerating anything.

The routes in `src/routes/capabilities.ts` are the whole surface:

| Route | What it does |
| --- | --- |
| `GET /tools`, `POST /tools/sync` | list the catalog, or refill it from the registry |
| `GET/POST /prompts`, `PATCH /prompts/:id`, `POST /prompts/:id/{archive,restore}`, `DELETE /prompts/:id` | prompts, same shape for `/skills` |
| `GET/POST /workspaces/:workspaceId/mcp/servers`, `PATCH /workspaces/:workspaceId/mcp/servers/:id`, `POST /workspaces/:workspaceId/mcp/servers/:id/{archive,restore}`, `DELETE /workspaces/:workspaceId/mcp/servers/:id` | the servers one workspace owns |
| `GET/PUT /workspaces/:workspaceId/grants` | the workspace's selection plus `allowAll` |
| `GET/PUT /agents/:agentId/grants` | the agent's selection, checked against its workspace |

`buildServer()` takes an explicit `Config` and never reads `process.env`, so
tests can build any environment without touching the real one.

Logging follows `NODE_ENV`: `development` pretty-prints through `pino-pretty`
(colour, `SYS:standard` timestamps, no `pid`/`hostname`), `production` emits pino's
JSON for a log collector, and `test` turns the logger off. `LOG_LEVEL` applies in
both cases that log.

## Scripts

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `tsx watch src/index.ts` | watches `src/` for changes |
| `build` | `tsc -p tsconfig.json` | emits to `dist/` |
| `start` | `node dist/index.js` | requires a prior build |
| `typecheck` | `tsc -p tsconfig.test.json` | type-checks source and tests, no emit |
| `lint` | `oxlint` | shared config from `@tctcl/oxlint-config/base.json` |
| `test` | `vitest run` | one-shot run, CI friendly |
| `test:watch` | `vitest` | watch mode |

## Running

```bash
pnpm dev:backend          # from the repo root
# or
pnpm --filter backend dev
```

```bash
curl -s http://127.0.0.1:8080/health
# {"status":"ok","uptime":1.54,"timestamp":"2026-11-22T02:47:26.447Z"}
```

An invalid environment exits with status 1 before the port is bound and lists
every problem at once:

```text
Invalid environment configuration:
  - NODE_ENV: Invalid option: expected one of "development"|"test"|"production"
  - PORT: must be a number
```

`SIGINT` and `SIGTERM` close the server; there is no connection draining or
worker shutdown yet.

## Configuration

Environment variables, validated once at startup by `src/config.ts`:

| Variable | Values | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `development`, `test`, `production` | `development` | disables the logger in `test`, hides internal error messages in `production` |
| `HOST` | non-empty string | `127.0.0.1` | `listen()` host |
| `PORT` | integer 1–65535 | `8080` | `listen()` port |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` | `info` | Fastify logger level |
| `DATABASE_URL` | `postgres://` or `postgresql://` URL | required | the durable log and the platform tables |
| `DATABASE_POOL_SIZE` | integer 1–100 | `10` | Postgres pool ceiling, read only when `DATABASE_URL` is set |
| `DOCKER_HOST` | non-empty string | `unix:///var/run/docker.sock` | the daemon environments are created on |
| `WORKSPACE_IMAGE` | non-empty string | `tctcl/dev-env:dev` | the image a workspace container is built from |
| `WORKSPACE_BACKEND_URL` | http(s) URL | none | how a container reaches this service for its documents; with `WORKSPACE_NETWORK`, both or neither |
| `WORKSPACE_NETWORK` | non-empty string | none | the network a container joins so it can resolve the backend |
| `TCTCL_CHANNEL` | `production`, `staging` | `production` | which release channel the update check asks about |
| `TCTCL_VERSION` | `X.Y.Z` | none | what this build is; absent in a checkout, so the check reports it cannot compare |
| `UPDATE_CHECK_INTERVAL_MS` | integer ≥ 0 | `900000` | how long a release answer is reused; `0` checks every time |
| `FRONTEND_DIR` | non-empty string | none | the compiled SPA to serve; absent means the service answers API routes only |
| `CIPHERGATE_URL` | http(s) URL | none | the secrets store; with `CIPHERGATE_TOKEN`, both or neither |
| `CIPHERGATE_TOKEN` | non-empty string | none | sent as `Authorization: Bearer` to the store |
| `SECRET_KEY` | string ≥ 16 characters | none | passphrase the secret box is keyed from; without it, no value can be sealed |
| `TRUST_PROXY` | `true`, `false` | `false` | believe `X-Forwarded-*`, which the secure-cookie check needs behind a proxy |
| `TERMINAL_MAX_SESSIONS` | integer 1–32 | `8` | terminals one environment may hold at once |
| `TERMINAL_SCROLLBACK_BYTES` | integer 0–4194304 | `262144` | output replayed to a client that reattaches |
| `TERMINAL_IDLE_TIMEOUT_MS` | integer ≥ 0 | `1800000` | reap a terminal with no client attached; `0` never reaps |

`process.loadEnvFile()` reads `apps/backend/.env` if it exists, so local
development needs no exports; elsewhere set the variables in the shell, compose
file or deployment environment. Anything not listed here is ignored, and a
missing `.env` is not an error.

Tool configuration:

- TypeScript: extends `@tctcl/typescript-config/fastify.json`, sources in
  `src/`, output in `dist/`. `tsconfig.json` excludes `*.test.ts` from the build;
  `tsconfig.test.json` re-includes them for the no-emit typecheck.
- Lint: `.oxlintrc.json` extends `../../packages/oxlint-config/base.json`.
- Tests: `vitest.config.ts` extends `@tctcl/vitest-config/base`.

## Agent

`src/agent.ts` opens a pi-durable `Harness` and serves one conversation per
thread:

- provider `opencode-go` (from `@earendil-works/pi-ai`), model
  `deepseek-v4.1-flash`, thinking level `low`
- the provider key is the newest OpenCode Go key stored on the credentials page
  (`src/providers/stored-credentials.ts`); `OPENCODE_API_KEY` is read by pi-ai, not
  by `src/config.ts`, and only answers when no key is stored
- one harness serves every thread: a harness is a Session over the whole log, not
  one conversation, so a thread's conversation is looked up by id
- a `SessionFailed` discards the harness and the next request reopens it, which is
  durable's documented recovery; what was committed stays

### Storage

Postgres holds both the durable log and the platform's own tables, so
`DATABASE_URL` has no fallback: an unset or unreachable database is a startup
failure, not a degraded mode.

`src/storage/postgres/` mirrors durable's own SQLite backend table for table. It is
checked by durable's conformance suite in `src/storage/postgres/storage.test.ts`,
which skips when `DATABASE_URL` is unset:

```bash
DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/tlabs' \
  pnpm --filter backend test
```

Each case runs under its own table prefix, so one case never sees another's rows.
Design notes: [`docs/postgres-adapter.md`](../../docs/postgres-adapter.md).

### Tables

Two sets share the database, told apart by prefix:

| Prefix | Tables | Owner |
| --- | --- | --- |
| `durable_` | `conversations`, `entries`, `tasks`, `submissions`, `record_ids`, `documents`, `document_revisions`, `schema`, `metadata` | durable's log |
| none | `users`, `chat_threads`, `workspaces`, `agents` | the platform |

`MIGRATIONS` in `src/storage/postgres/schema.ts` is the ordered history: version 1
creates the log, version 2 the platform tables, version 3 repairs the legacy table
layout, version 4 adds workspaces and agents and files every existing thread under
the default pair, version 5 adds `archived_at` to workspaces, agents and threads, and
version 11 adds `workspaces.position` — the list order the user drags into place,
backfilled newest-first. A release appends a version and never edits one.
`createSchema(prefix)` applies the caller's prefix to both sets
(the tests use it to isolate cases) and `DURABLE_PREFIX` to the log alone.

`chat_threads` holds only what the log cannot: `owner_id`, `workspace_id`,
`agent_id`, `title`, `durable_conversation_id` (`bigint`, unique), `archived_at` and
timestamps. Messages stay in `entries`. `users` has one row — `ensureLocalUser()` seeds
a fixed id, so a restart finds it instead of adding a second.

`workspaces` and `agents` are one-to-many: a workspace declares the ceiling through
its grants (the `workspace_*` link tables, plus `allow_all` for "everything,
including what does not exist yet") and each agent narrows it with its own `agent_*`
links, `system_prompt` and `instructions`. `allow_all` on either side means a grant
needs no enumeration; `createCapabilityApi()` in `src/capabilities/api.ts` is what
refuses an agent grant the workspace does not reach, with `400
CAPABILITY_NOT_ALLOWED`. Migration v4 seeds exactly one workspace and one agent per
user, both immutable: they are what a new thread uses when it names neither, and a
thread in a workspace without a default agent is refused with `400 AGENT_REQUIRED`.
An agent's `system_prompt` and `instructions` are joined and passed to the durable
conversation as its `instructions` section when the thread is created, so editing an
agent later rewrites only conversations created afterwards; the grants are stored
and validated but not yet read by the harness.

### Archiving

All three tables carry `archived_at`. Archiving hides a row from the default listing
(`?archived=true` lists the archived ones instead) and archives everything below it in
one transaction: a workspace takes its agents and threads, an agent takes its threads.
Restoring lifts the flag from that row alone, so nothing archived separately comes back
by surprise. Deleting is the second half of archiving and only applies to an archived
row; it is refused with `409 NOT_ARCHIVED` while the row is live, and with
`409 *_IN_USE` when a child was restored on its own.

### Routes

| Route | Body | Answer |
| --- | --- | --- |
| `GET /me` | — | `{ "id", "name" }`: the identity the session belongs to |
| `POST /auth/login` | `{ "username", "password" }` | the actor and the session cookie, or `401` when the pair is wrong |
| `POST /auth/logout` | — | `204`, cookie cleared |
| `GET /auth/session` | — | `{ "id", "name", "username", "permissions", "pending", "singleUser" }` |
| `POST /auth/2fa/verify` | `{ "code" }` | the actor once the second factor is satisfied |
| `POST /auth/password/initial` | `{ "password" }` | `204`; `409 auth.no_step` unless a password change is waiting |
| `POST /auth/password/change` | `{ "current", "next" }` | `204` |
| `POST /auth/2fa/setup` | — | `{ "secret", "uri" }`, which is not enabled until a code proves it |
| `POST /auth/2fa/enable` | `{ "code" }` | `204` |
| `POST /auth/2fa/disable` | `{ "password" }` | `204` |
| `GET /roles` | — | `[role]`, each with `builtin`, `grantsAll` and its permissions; needs `users.manage` |
| `GET /users` | — | `[user]`: `id`, `username`, `name`, `roleId`, `disabled`, `totp`, `passwordChange` |
| `POST /users` | `{ "username", "roleId", "name"?, "password"? }` | `201` and `{ "user", "password" }`, the second field being the one-time password |
| `POST /users/:id/reset` | — | `{ "user", "password" }`, a fresh one-time password |
| `PUT /users/:id/role` | `{ "roleId" }` | `204` |
| `PUT /users/:id/disabled` | `{ "disabled" }` | `204` |
| `GET /settings`, `PUT /settings` | `{ "singleUser"?, "requireTwoFactor"? }` | the two switches on an install; needs `settings.manage` |
| `GET /settings/public` | — | `{ "singleUser" }`: the only unauthenticated read, so a client knows whether to draw a login screen |
| `GET /credentials` | — | `{ "credentials": [{ "id", "kind", "name", "expiresAt", "email", "note", "mcpId", "createdAt", "updatedAt" }] }`; the value never comes back |
| `POST /credentials` | `{ "kind", "name", "value", "expiresAt"?, "email"?, "note"?, "mcpId"? }` | `201` and the credential; `opencode-go` needs `email`, `mcp` needs `mcpId` |
| `DELETE /credentials/:credentialId` | — | `204`, or `409` while an MCP server still names it |
| `GET /workspaces/:workspaceId/environments/:environmentId/terminals` | — | `{ "terminals": [...] }`, oldest first |
| `POST /workspaces/:workspaceId/environments/:environmentId/terminals` | `{ "label"?, "size"?: { "cols", "rows" } }` | `201` and the session; `409 ENVIRONMENT_STOPPED` / `TERMINAL_LIMIT_REACHED` |
| `DELETE /workspaces/:workspaceId/environments/:environmentId/terminals/:terminalId` | — | `204` once the process is gone |
| `GET /workspaces/:workspaceId/environments/:environmentId/terminals/:terminalId/attach` | — | a websocket: binary frames are bytes, text frames are `ready` / `exit` / `error` / `resize` |
| `GET /threads?workspaceId=&archived=` | — | `{ "threads": [...] }`, most recently changed first, narrowed to one workspace when named |
| `POST /threads` | `{ "title"?, "workspaceId"?, "agentId"? }` | `201` and the thread |
| `POST /threads/:threadId/archive` | — | the thread, stamped |
| `POST /threads/:threadId/restore` | — | the thread, unstamped |
| `GET /threads/:threadId/messages` | — | `{ "messages": [{ "role", "text" }] }` |
| `GET /threads/:threadId/context` | — | `{ "provider", "modelId", "contextWindow", "used", "remaining", "categories": [{ "kind", "tokens" }] }`, every number estimated at `chars / 4` |
| `POST /threads/:threadId/messages` | `{ "message": "..." }` | `{ "reply": "..." }` |
| `GET /workspaces?archived=` | — | `{ "workspaces": [...] }`, in the user's stored order |
| `PUT /workspaces/order` | `{ "order": [workspaceId, …] }` | the whole list renumbered; `400` unless the ids are exactly the live workspaces |
| `POST /workspaces` | `{ "name", "description"?, "allowAll"? }` | `201` and the workspace, at the top of the list, together with the one environment it runs in |
| `GET /workspaces/:workspaceId/environments` | — | `{ "environments": [...] }`: one, or none for the default workspace, which runs on the host |
| `POST /workspaces/:workspaceId/environments` | `{ "environmentId" }` | `204`; `409 ENVIRONMENT_ALREADY_ATTACHED` when the workspace already runs in another one |
| `DELETE /workspaces/:workspaceId/environments/:environmentId` | — | `204` for the default workspace; `409 ENVIRONMENT_REQUIRED` for any other, which may not lose its container |
| `GET /workspaces/:workspaceId` | — | the workspace |
| `PATCH /workspaces/:workspaceId` | any subset of the create body | the workspace |
| `POST /workspaces/:workspaceId/archive` | — | the workspace, stamped |
| `POST /workspaces/:workspaceId/restore` | — | the workspace, unstamped |
| `DELETE /workspaces/:workspaceId` | — | `204` |
| `GET /workspaces/:workspaceId/agents?archived=` | — | `{ "agents": [...] }`, by name |
| `POST /workspaces/:workspaceId/agents` | `{ "name", "description"?, "tools"?, "mcpServers"?, "skills"?, "systemPrompt"?, "instructions"? }` | `201` and the agent |
| `PATCH /workspaces/:workspaceId/agents/:agentId` | any subset of the create body | the agent |
| `POST /workspaces/:workspaceId/agents/:agentId/archive` | — | the agent, stamped |
| `POST /workspaces/:workspaceId/agents/:agentId/restore` | — | the agent, unstamped |
| `DELETE /workspaces/:workspaceId/agents/:agentId` | — | `204` |
| `GET /providers/logins` | — | `{ "logins": [{ "id", "provider", "label", "createdAt" }] }`, newest first; the key itself never comes back |
| `POST /providers/logins` | `{ "provider", "label", "key" }` | `201` and the login; the key is proved against the provider first, so `400 PROVIDER_KEY_INVALID` / `PROVIDER_KEY_NOT_ENTITLED` / `400 PROVIDER_UNSUPPORTED` / `502 PROVIDER_UNAVAILABLE` |
| `GET /providers/models` | — | `{ "models": [...] }`, the catalog cached by the last successful refresh |
| `GET/PUT /workspaces/:workspaceId/providers` | `{ "loginIds", "allowedModels", "allowAllModels" }` | what the workspace may spend; `404 WORKSPACE_NOT_FOUND` |
| `GET /workspaces/:workspaceId/providers/usage` | — | `{ "usage": [{ "provider", "loginCount", "requests", "inputTokens", "outputTokens", "costUsd" }] }`, the counters still zero |
| `GET /environments/:environmentId/ssh` | — | the published endpoint as `{ "command", "host", "port", "user" }`, or `null` when the container published none |
| `GET /environments/:environmentId/ssh/tunnels` | — | `{ "tunnels": [] }`: nothing forwards a port yet |

### Workspace environments

A workspace runs in exactly one environment, and the row is created with the workspace in the same transaction: the
workspace and the container it names become visible together, or neither does. The environment takes the workspace's
name and the `WORKSPACE_IMAGE` the process was started with — the image is configuration, so a migration cannot write it,
and `WorkspaceRepository.ensureEnvironments` fills in the workspaces that predate the rule on every boot (idempotent; it
writes nothing once every workspace has one).

The default workspace is the exception: it runs on this host, has no environment, and is the only workspace that may be
detached from one. `workspace_environments` carries a unique index on `workspace_id`, so a second link is a constraint
violation rather than something the routes have to remember; `DELETE /environments/:environmentId` answers
`409 ENVIRONMENT_IN_USE` while a non-default workspace runs in it.

### Environments

An environment is one container, provisioned by `src/environments/container-runtime.ts` and named
`tctcl-env-<id>`. `POST /environments` records the row; `POST /environments/:environmentId/start` creates the
container if it is missing (pulling the image when the host has never seen it), starts it and records the id Docker
answered; `stop` keeps the row and the id, so the next start reuses the container instead of paying for another one;
`DELETE` removes the container before the row.

`GET /environments/:environmentId` answers the row plus a `status` read from Docker on the way out: `running`,
`stopped` or `missing`. It has to be read rather than stored — `containerId` records what a container was called, and
`docker system prune` or a host reinstall takes the container out from under it. The list carries no status on
purpose: that would be one `inspect` per row, and the collection stays a database read.

`GET /environments/:environmentId/metrics` answers one sample of a running container, and
`409 ENVIRONMENT_STOPPED` when there is none to take. Every number is in base units: `cpuPercent` is a share of all
cores, computed from the delta against `precpu_stats` because Docker's counters are cumulative; `memoryUsedBytes`
subtracts page cache the way `docker stats` does; `memoryLimitBytes` and the network and block-I/O byte counters need
no conversion. Poll it — nothing streams samples, and two seconds is honest for CPU and memory.

Nothing in `HostConfig` sets a memory or CPU limit yet, so the limit is the host's and `cpuPercent` may exceed 100 on a
multi-core machine. Metrics answer for a container that is running: a stopped one has no reading, and zeros would draw
as an idle environment rather than an absent one.

### Terminals

A terminal is a `docker exec` with a TTY inside the environment's container:
`apps/backend/src/terminal/pty.ts` opens it, `sessions.ts` keeps the session, scrollback and
idle reaper, `routes/terminals.ts` speaks HTTP and the socket. Escape sequences are passed
through untouched and rendered by the emulator in the browser, a resize is clamped rather
than refused, and a session outlives its client so a reattach replays recent output instead
of starting blank. Sessions are in memory, so a restart means the client lists again.
Contract, frames and lifetime rules: [`docs/terminals.md`](../../docs/terminals.md).

### Context usage

`GET /threads/:threadId/context` describes what the thread's next request would carry:
`messages`, `systemPrompt` and `systemTools`, plus the model's window and what is left of it.
The numbers are estimated at `Math.ceil(chars / 4)`, the same approximation the harness uses to
decide when to compact, because no provider reports a split and a thread must have a share to
draw before it has answered once. `src/context-usage.ts` replays the `pi.system` entries to
recover the prompt and the offered tools — a section is replaced by name, a tool arrives with
`toolsAdded` and leaves with `toolsRemoved` — so the split matches the request rather than the
agent's current configuration, which may have been edited since.

Only categories with a source are reported. Skills, memory files, MCP tools and MCP server
instructions have no rendered section yet — `src/agent.ts` keeps them declarative, "unread by
the harness" — deferred tools are a harness concept nothing here enables, and the autocompact
buffer is a pi-durable default the harness does not expose. They join the response when they
have something true to report, rather than as zeros that suggest they are empty.

Ids are validated as uuids before they reach the driver. A missing thread is
`404 THREAD_NOT_FOUND`, a submission that settles `unanswered` is
`502 AGENT_UNANSWERED`, and a database the agent cannot reach is
`503 AGENT_UNAVAILABLE`.

Workspace and agent errors: `403 WORKSPACE_IMMUTABLE` / `AGENT_IMMUTABLE` for the
seeded pair (it cannot be edited, archived or deleted), `409 WORKSPACE_IN_USE` /
`AGENT_IN_USE` while a live child row still points at it,
`409 WORKSPACE_NOT_ARCHIVED` / `AGENT_NOT_ARCHIVED` / `THREAD_NOT_ARCHIVED` when a
delete arrives before the archive, `400 CAPABILITY_NOT_ALLOWED` when an agent asks for
something its workspace does not grant, and `400 AGENT_WORKSPACE_MISMATCH` when a
thread names an agent from another workspace. Archiving is a one-way door for writes:
`409 WORKSPACE_ARCHIVED` / `AGENT_ARCHIVED` for new agents, edits and new threads,
and `409 THREAD_ARCHIVED` for a message sent to an archived thread.

```bash
curl -s http://127.0.0.1:8080/threads
# {"threads":[]}
THREAD=$(curl -s -X POST http://127.0.0.1:8080/threads -H 'content-type: application/json' -d '{}' | jq -r .id)
curl -s -X POST http://127.0.0.1:8080/threads/$THREAD/messages \
  -H 'content-type: application/json' -d '{"message":"Reply with exactly: pong"}'
# {"reply":"pong"}
```

## Errors

`registerErrorHandling()` is called on the root Fastify instance. Fastify error
handlers are encapsulated, so an error handler registered inside a plugin would
not cover routes registered by sibling plugins.

| Situation | Status | Body |
| --- | --- | --- |
| Unknown route | 404 | `{ "error": { "code": "NOT_FOUND", "message": "Route GET /x not found" } }` |
| `AppError` thrown | `error.statusCode` | `{ "error": { "code": error.code, "message": error.message } }` |
| Fastify schema rejection | 400 | `{ "error": { "code": "VALIDATION_ERROR", "message": ... } }` |
| Any other `Error` | 500 | `{ "error": { "code": "INTERNAL_ERROR", "message": "Internal server error" } }` |

In `development` and `test` the 500 body carries the original message; in
`production` it is the literal `Internal server error`.

## Adding a route

Write a `FastifyPluginAsync` next to `src/routes/health.ts`, then register it in
`src/plugins/index.ts`. Keep `src/server.ts` down to instance options plus the
single `registerPlugins()` call.

## Testing

Routes are tested through Fastify's `inject()`, so no port is opened:

```ts
const agent = { ask: async (input) => `echo: ${input}`, close: async () => {} }
const server = buildServer(loadConfig({ NODE_ENV: 'test' }), { agent })
const response = await server.inject({ method: 'GET', url: '/health' })
```

`NODE_ENV=test` disables the logger, so failing tests do not print request logs.
Routes take the `Agent` through `buildServer()` options, so no test touches a
provider or a harness.
