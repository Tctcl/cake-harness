# backend

Fastify HTTP service for the tctcl platform.

**Status: chat slice with workspaces.** The service boots from a validated environment, logs
through Fastify's logger, answers `GET /health`, serves chat threads over a
pi-durable session in Postgres, files those threads under a workspace and an agent, and renders errors as
`{ error: { code, message } }`. There is one local user and no sign-in yet.

```text
src/index.ts          bootstrap: load config, open the agent, build, listen, close
src/server.ts         buildServer(config, { agent }) — the importable factory tests use
src/config.ts         zod schema for process.env, loadConfig(), ConfigError
src/errors.ts         AppError: statusCode + stable code for errors that cross HTTP
src/error-handler.ts  error and not-found handlers (registered on the root instance)
src/plugins/index.ts  single plugin registration point
src/routes/health.ts  GET /health
src/routes/me.ts      GET /me, the identity the sessions belong to
src/routes/threads.ts /threads and /threads/:threadId/messages
src/routes/workspaces.ts /workspaces and /workspaces/:workspaceId/agents
src/routes/capabilities.ts /tools, /prompts, /skills, /mcp/... and the grants of a workspace or an agent
src/agent.ts          harness, one conversation per thread, the model it runs
src/threads/          users/chat_threads rows: local-user bootstrap and repository
src/capabilities/     the catalogs (tools synced from the registry, prompts, skills, MCP servers, credentials), the
                      link tables that grant them, and the ceiling check
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
separate tables so a skill can grow without moving rows. `mcp_servers` says how to
reach a server and which environment variables it reads (`env_schema`: env var →
CipherGate secret name); `mcp_credentials` names a consumer and the secrets that
fill that map, so one server carries many credentials and no value is ever stored
here.

Grants live in `workspace_tools`, `workspace_prompts`, `workspace_skills`,
`workspace_mcp_servers` (plus `default_credential_id`), `workspace_mcp_credentials`,
and the matching `agent_*` tables. Every link is a foreign key, so a grant of a row
that does not exist is refused by the database. `agent_mcp_servers.credential_id`
is nullable: `null` means "the workspace's default for that server", and a
credential is checked against its own server by a composite foreign key.

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
| `GET/POST /mcp/servers`, `PATCH /mcp/servers/:id`, `POST /mcp/servers/:id/{archive,restore}`, `DELETE /mcp/servers/:id` | server definitions |
| `GET/POST /mcp/servers/:serverId/credentials`, `PATCH /mcp/credentials/:id`, `POST /mcp/credentials/:id/{archive,restore}`, `DELETE /mcp/credentials/:id` | credentials of one server |
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
- `OPENCODE_API_KEY` supplies the provider key; it is read by pi-ai, not by
  `src/config.ts`
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
the default pair, version 5 adds `archived_at` to workspaces, agents and threads. A
release appends a version and never edits one.
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
| `GET /me` | — | `{ "id", "name" }`: the seeded local user, the only identity a session can name |
| `GET /threads?workspaceId=&archived=` | — | `{ "threads": [...] }`, most recently changed first, narrowed to one workspace when named |
| `POST /threads` | `{ "title"?, "workspaceId"?, "agentId"? }` | `201` and the thread |
| `POST /threads/:threadId/archive` | — | the thread, stamped |
| `POST /threads/:threadId/restore` | — | the thread, unstamped |
| `GET /threads/:threadId/messages` | — | `{ "messages": [{ "role", "text" }] }` |
| `POST /threads/:threadId/messages` | `{ "message": "..." }` | `{ "reply": "..." }` |
| `GET /workspaces?archived=` | — | `{ "workspaces": [...] }`, most recently changed first |
| `POST /workspaces` | `{ "name", "description"?, "container"?, "allowed*"? }` | `201` and the workspace |
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
