# Deferred work

Every slice in this repository deliberately stops somewhere. This file is the
single list of what was left out, so the answer to "why does it not do X yet?"
lives in Git instead of in a conversation.

Each item states what is missing, where it currently stands in the code, and
what closing it would take. Nothing here is a promise of order; it is an
inventory. When an item is done, delete it and let `CHANGELOG.md` record the
change.

## 1. Attachments

**Missing:** a conversation cannot carry a file, image or pasted payload at all.

**Where it stands:** there is no table, no route and nowhere to put bytes.
`apps/backend/src/storage/postgres/schema.ts` defines `durable_entries`, `users`,
`chat_threads`, `workspaces` and `agents`; none of them is about files.
`apps/backend/src/routes/threads.ts` accepts `{ text }` only, and the backend has
no multipart handling (`fastify` alone, no `@fastify/multipart`, no object-store
client). The durable entry stores the message text inside `record json`, so a
part the model can read but the backend cannot store has nowhere to live.

**What it would take:**

- A storage decision recorded in `docs/`: a configured filesystem root versus an
  object store. AGENTS.md rule 4 means the filesystem root is the default answer
  until a second requirement appears.
- `MIGRATIONS[n]` adding an `attachments` table: id, thread and entry reference,
  filename, media type, byte size, checksum, storage key, created_at.
- A multipart upload route, size and media-type limits validated where the
  request enters (AGENTS.md: fail loudly at the edges), and a read route that
  streams bytes back with the stored media type.
- A way to reference uploads from a message entry so the harness sees them, and
  the frontend's vendored `Attachment` element wired to the upload route.

## 2. The agent profile does not yet drive the run

**Missing:** an agent's `tools`, `mcp_servers` and `skills` have no effect on
what the harness may do.

**Where it stands:** `instructionsOf` in `apps/backend/src/agent.ts` says so in a comment —
the system prompt and instructions are composed into the conversation's system
prompt when the conversation is created, and "only tools, MCP servers and skills
stay declarative for now, unread by the harness". Editing an agent therefore does
not change conversations that already exist.

**What it would take:** passing the agent's grants into `Harness.open` (registry,
tool allowlist, MCP clients), deciding what a mid-conversation profile edit means
for an open conversation, and resolving credentials to values at launch.

The storage and the write path exist now. Migration 6 added the catalogs
(`tools`, `prompts`, `skills`, `mcp_servers`, `mcp_credentials`) and the link
tables; migration 7 dropped the `text[]` columns they replaced, so the links are
the only place a selection lives. `src/routes/capabilities.ts` reads and writes
both the catalogs and the grants, the workspace manager's Tools, Skills, Prompts and MCP tabs draw
them, and `createCapabilityApi().setAgentGrants()` enforces the ceiling with
`400 CAPABILITY_NOT_ALLOWED`. What is still missing is the last hop: the harness
opens with the registry's default tool set and never asks for a grant.

Credentials are never stored here: an `mcp_credentials` row names a CipherGate
consumer and the secrets that fill a server's `env_schema`, and the value is
fetched when a run starts. The client that fetches them exists now, but only one
caller uses it: `apps/backend/src/secrets/ciphergate.ts` reads a secret by name on
behalf of `apps/backend/src/environments/manifest.ts`, which serves workspace
credentials. Resolving a run's MCP credentials is still unimplemented — the
`mcp_credentials` rows are read by the capability routes and by nothing else.

## 3. Workspace containers do not run the agent

**Missing:** a conversation's tools do not execute in its workspace's container.

**Where it stands:** every workspace except the default one has an environment: a
container from the workspace image, started, stopped and inspected through
`apps/backend/src/environments/` and the read-write Docker proxy, with terminals
attached over a websocket (`docs/terminals.md`). The container bootstraps itself
from the backend's manifest (`apps/agent`, `docs/remote-development.md`). The
harness still runs inside the backend with no tools, so nothing a conversation
does reaches the container.

**What it would take:** an execution environment per workspace that the harness's
tools run in (see `docs/durable.md` for the two MCP paths and the container
caveat), and the tool wiring from item 2.

## 4. One hardcoded model

**Missing:** model and thinking level are chosen by whoever edits the source.

**Where it stands:** the constants at the top of `apps/backend/src/agent.ts` —
`MODEL = { provider: 'opencode-go', modelId: 'deepseek-v4.1-flash' }` and
`THINKING_LEVEL = 'low'`. Neither is configurable per agent, per workspace or per
conversation, and the frontend has no selector.

**What it would take:** columns or JSON on `agents` for model and thinking level,
validated against a known model list, threaded into the harness call, plus the AI
Elements model selector in the composer. This is the natural companion to item 9.

## 5. Thread lifecycle stops at delete and title generation

**Missing:** a thread cannot be deleted, archived threads cannot be browsed, and
nothing generates a title.

**Where it stands:** `PATCH /threads/:threadId` now exists
(`apps/backend/src/routes/threads.ts`) and the topbar edits the title in
place (`apps/frontend/src/components/layout/topbar.tsx`), over
`ThreadRepository.rename` (`apps/backend/src/threads/thread-repository.ts:131`).
`remove` (line 153) is still unrouted: the repository keeps the "archive first,
or it is not settled" guard, so a live thread can never be removed by one
request. Threads are still created with `title: null`, so an unnamed conversation
reads "Untitled conversation" until someone renames it. All three list routes
take `?archived=true` (`threads.ts:109-112`, `workspaces.ts`), and the frontend
asks for none of them.

**What it would take:** `DELETE /threads/:threadId` over the existing repository
method, an archived view in the left sidebar, and a title strategy (first line of
the first message, or a generated one) so the rename route has something to
correct.

## 6. Agents are read-only in the UI

**Missing:** an agent cannot be created, edited, archived or deleted from the
frontend.

**Where it stands:** the backend serves the whole agent surface
(`/workspaces/:id/agents` and `/workspaces/:id/agents/:agentId`, in
`apps/backend/src/routes/workspaces.ts`). The workspace manager
(`apps/frontend/src/components/workspaces/`) edits everything else a workspace
has: name, description and `allowAll`, tool, prompt and skill grants, MCP servers,
providers and the environment. Agents only appear as the profile a conversation
runs with, read-only in the info panel. Threads still cannot be deleted from the UI
(item 5).

**What it would take:** an agent editor in the workspace manager over the existing
routes, with the capability picker narrowed to what the workspace allows.

## 7. Accounts exist, but the routes still answer as one owner

**Missing:** per-request ownership, so a second account can be created and
actually used.

**Where it stands:** sessions, roles, permissions, TOTP, the sign-in screen
(`apps/frontend/src/components/auth/auth-gate.tsx`) and the installer's
first-admin step (`bootstrap-admin.js`, `docs/auth.md`) are in place. A deployed
install has exactly one account, the seeded owner, and signs in. What is not in
place: `apps/backend/src/agent.ts` closes over one `ownerId` from
`ensureLocalUser`, so workspaces, agents, threads and environments all resolve to
the seeded row whoever asks. Until that changes, `PUT /settings` refuses
`{"singleUser": false}` and `POST /users` refuses every new account, both with
`409 auth.accounts_pending`. Enrolling a second factor has no screen.

**What it would take:** threading the actor's id through the `Agent` API in place
of the captured `ownerId` (workspaces, agents, threads, environments and the
capability links that hang off workspaces), a user-management screen, and then
deleting the `MULTI_USER_WIRED` guard in `apps/backend/src/auth/service.ts`.

## 8. A run's steps are a flat list, not a timeline

**Missing:** tool calls are shown, but only as one block under the reply. They
are not interleaved with the messages they happened between, retries are not
distinguished from first attempts, and there is no step skeleton for the parts of
a run that produced no message.

**Where it stands:** each stream frame carries `ThreadUpdate`
(`apps/backend/src/agent.ts`) with `messages`, `tools`, `run`, `usage` and `live`,
so the client sees every tool call the run made — `apps/frontend/src/components/chat/tool-trace.tsx`
renders the settled ones through AI Elements `Trace`, and
`apps/frontend/src/components/chat/live-run.tsx` renders the run in flight in the
order the provider produced it (reasoning, text, calls) from `live.blocks`. The
committed calls are still ordered by call, not placed alongside the entries in
between, because durable entries do not record which tool call answered which
message.

**What it would take:** an entry-level link between a tool call and the transcript
position it belongs to (a sequence number per entry in the durable log, or a
field on the tool entry naming its parent), then rendering each call inside the
message stream instead of below it.

## 9. The composer is not the registry `PromptInput`

**Missing:** the AI Elements `PromptInput` (attachments, model selector, tool
chips) is not installed.

**Where it stands:** `apps/frontend/src/components/chat/prompt-input.tsx` is a
local component over `Textarea` and `Button` — Enter sends, Shift+Enter breaks the
line. It has no attachment tray and no model control because neither backend
capability exists (items 1 and 4).

**What it would take:** items 1 and 4 first, then the registry component and the
`Attachment` tray. Until then it is deliberately smaller than the registry
version, not accidentally so.

## 10. `apps/agent` is still a scaffold

**Missing:** the platform does not run the agent as a separate long-running
process; the harness lives inside the backend.

**Where it stands:** `apps/agent` holds the workspace bootstrap and its image (see
`docs/remote-development.md`); the harness, the repositories and the routes all
run in `apps/backend`, which is fine for one
process and one user, and is the thing that will need revisiting when runs must
outlive a backend restart or move to another machine.

**What it would take:** an explicit architecture decision in `docs/` about what
`apps/agent` is for — a worker consuming a queue, a supervisor for workspace
containers (item 3), or nothing at all. Do not build it speculatively; decide
first.

## 11. No coverage provider, no threshold

**Missing:** `pnpm test` reports pass/fail, not coverage.

**Where it stands:** `@vitest/coverage-v8` is not installed in any workspace, by
decision (AGENTS.md: do not add it without deciding a threshold first).

**What it would take:** a threshold agreed in `docs/`, the dependency added once
at the shared `packages/vitest-config` layer, and the gate in
`.github/workflows/gates.yml` extended. Until then do not quote coverage numbers.

## 12. No formatter

**Missing:** nothing formats the codebase. Style is held only by `.editorconfig`
and the warnings oxlint happens to raise.

**Where it stands:** no workspace has a `format` or `format:check` script, no
formatter is a dependency, and `.github/workflows/gates.yml` runs the four gates
AGENTS.md names — typecheck, lint, test, build. Root `.editorconfig` enforces
charset, LF, final newline, trailing whitespace and 2-space indent, which covers
most of the risk while the codebase is small and written by one person. oxlint
1.90 lints; it does not format.

**Decision, so it does not have to be relitigated:** when a formatter is adopted
it is `oxfmt`, not Biome and not Prettier. Biome also lints, which would put a
second rule set beside `@tctcl/oxlint-config`; Prettier costs the most in a
turbo/pnpm monorepo for no capability this repository needs. oxfmt keeps the
vendor, the config lineage and the editor extension (`oxc.oxc-vscode`) already in
use for lint.

**What it would take:** a shared `@tctcl/oxfmt-config` package beside the other
presets (AGENTS.md rule 5), `format` and `format:check` scripts per workspace,
the initial repo-wide reformat as its own `chore:` commit so it never rides along
with a behavioural change, and a deliberate fifth step in the gates workflow.
Know two limits before committing to it: oxfmt does not support Prettier plugins,
so `prettier-plugin-tailwindcss` class sorting is unavailable, and its default
`printWidth` is 100 rather than Prettier's 80. The formatter is still pre-1.0
(0.80 at the time of writing) and releases weekly, so expect occasional output
changes rather than a frozen format.

Revisit when a second regular contributor joins, or when formatting noise
obscures a real diff. Until then the `.editorconfig` is the contract.

## 13. Documentation debt

- `docs/postgres-adapter.md` and `docs/durable.md` predate the platform tables
  (`workspaces`, `agents`, capabilities, environments, auth, providers). Neither
  describes them; `apps/backend/src/storage/postgres/schema.ts` and its migration
  list are the source of truth until they do.

## 14. The backend cannot update its own host

**Missing:** the update socket works and nothing calls it.

**Where it stands:** `infrastructure/systemd/tctcl-updater.socket` and
`tctcl-updater@.service` are installed by `install.sh`, and
`infrastructure/tctcl-updater.sh` implements the one-line protocol (`UPDATE 1.2.3`
in, `START`/progress/`OK`/`ERR` out) documented in `docs/deployment.md`. No
backend code opens `/run/tctcl/updater.sock`: there is no route, no progress
stream and no container that mounts the directory.

**What it would take:** the application container mounts `/run/tctcl` and runs
with gid 1001; a backend client that writes one line and streams the reply; a
route behind whatever authentication item 7 ends up with, since triggering an
update is a privileged action; and a UI that shows the installer's output instead
of a spinner.

## 15. No backups, no restore

**Missing:** nothing copies the database or the state directory, and there is no
restore path to test.

**Where it stands:** Postgres is the named volume `tctcl_postgres-data` and the
rest of the state is bind-mounted under `/var/lib/tctcl-platform`. Both are
described in `docs/deployment.md`; neither is copied anywhere.

**What it would take:** the decision that the backend drives backups (it will
need the state directory mounted, an exception to the "no unnecessary host
mounts" rule that has to be written down), a `pg_dump` plus a tar of the bind
mounts on a schedule with retention, and a restore command that is actually
exercised. A bind-mounted data directory copied while Postgres runs is a torn
snapshot, so the dump is the unit of restore — not `cp -a`.

Related: an upgrade that ran a migration cannot be rolled back in place. Until a
schema policy exists, the pre-upgrade dump is the only way back, which is another
reason this lands before the first real deployment.

## 16. The Docker API is still host root

**Missing:** a real boundary between the backend and the host.

**Where it stands:** both consumers talk to `tecnativa/docker-socket-proxy`
instead of the socket, with the endpoint list in `deploy/compose.yaml` and the
caveat spelled out in `docs/deployment.md`. The filter keeps unrelated API
surface out of reach; it does not stop a privileged container create, and
`CONTAINERS` plus `POST` are exactly what provisioning a workspace needs.

**What it would take:** rootless Docker on the host, or a provisioning path that
never creates privileged containers and is enforced somewhere the backend cannot
edit. Both are architecture decisions, not follow-ups.
