# Agent runtime: pi-durable in the backend

Research notes and the architecture decision for running agents in Cake.
Written so an agent (human or AI) can pick this up without re-reading upstream.

Status: **chat and container tools over Postgres.** `apps/backend` runs a durable
`Harness` over the Postgres adapter
([`docs/postgres-adapter.md`](./postgres-adapter.md)) and keeps one conversation
per row of `chat_threads`. The agent profile chooses the model, thinking level,
system prompt append, instructions and granted tools. Application settings supply
the shared base system prompt. Reads are paged (`GET /threads/:threadId/messages`,
an opaque cursor). A run streams as server-sent events
(`GET /threads/:threadId/stream`): each frame is the newest window of the
transcript plus the live run (reasoning, partial text, tool slots) and the usage
totals. `apps/agent` runs the workspace bootstrap, not the harness. MCP servers and
skills are stored but are not wired into runs.

## Prompt context in the transcript

The app's System prompt setting is rendered by the process-wide `cake` extension
as the `cake-system` section before each request, and the agent's system prompt
append follows it as the `instructions` section. Both are identity, so they stay
in the system message: durable records them as `pi.system` entries and renders
them again on every request. The transcript projects those entries into collapsed
context rows; expanding a section shows the recorded text, while later changes
appear as **Context updated**.

Everything that can change between two turns is not in the system message. The
agent's instructions and a compact account of the turn — its tools with a
one-line purpose each, the sub agents `delegate` may call with their default and
allowed models, and its skills — travel as a **reminder**: a second text block of
the user's own input, built fresh in `src/agents/turn-reminder.ts` on every
submission from the live rows, so a sub agent assigned or a tool granted between
two turns is named from the turn that sees it. The reminder is recorded in the
entry's `data` (`kind: cake.turn`), which is what lets the transcript show it as a
collapsed **Reminder** row under the user's line while the bubble keeps only the
words the person typed. A steer joins the run in flight and carries no reminder.
Sub agents get the same shape — their instructions and their own tools, never
`ask_user` or `delegate`.

Tool call arguments and results are clipped to 4,000 characters in stream frames.
When a reader expands a clipped call, `GET /threads/:threadId/tool-calls/:callId`
loads the complete recorded arguments and result from the conversation entries.

Sources (read 2026-11-22):

- `@earendil-works/pi-durable` README — <https://github.com/earendil-works/pi/blob/main/packages/durable/README.md>
- `@earendil-works/pi-env` README — <https://github.com/earendil-works/pi/blob/main/packages/env/README.md>
- `@earendil-works/pi-mcp` README — <https://github.com/earendil-works/pi/blob/main/packages/mcp/README.md>
- `@earendil-works/pi-coding-agent` README — <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md>

All four are MIT. Published `1.6.0` (2026-11-20), the same version as the local pi
install. Durable's README carries the banner *"Experimental. The API changes without
notice between releases."* — pin exact versions, expect churn, never edit a
`node_modules` copy to make it work.

## The decision

Durable owns the agent loop **in the backend**. Agent hosts (containers) execute
tools only. We write no MCP client, no compaction, no session storage, no streaming
protocol of our own.

```text
backend (pi-durable)                          agent host / container (pi-env daemon)
  Harness: loop, tasks, storage, model keys     read / write / edit / bash execute here
  tools: built-in + read-only + codemode ─────►   MCP stdio servers run here
  HTTP/WS API for our own frontend
```

Rejected alternative: running pi (RPC mode or SDK) inside the agent app and having
the backend orchestrate. That produces two agent loops, no atomicity between
backend state and agent state, and a control protocol we would have to invent.

The owner approved `@earendil-works/pi-env@1.6.0` as an exact backend dependency
for this design. It supplies `RemoteExecutionEnv`, `Connection` and the packaged
Linux daemon binaries; Cake does not reimplement durable's filesystem and
shell semantics over individual Docker execs. The daemon is delivered at run time,
so the workspace image does not contain a pi-env artifact.

## Tools, grants and the container transport

The process-wide registry installs pi-durable's `coding-tools` extension (`read`,
`write`, `edit`, `bash`), the backend's `readonly-tools` extension (`grep`,
`find`, `ls`, `git`), the env-free `web` extension (`web_fetch`), and pi-durable's
`codemode` extension. At startup the registry syncs into the tool catalog
automatically. Before conversation creation and every submission,
`agents/tool-selection.ts` removes every extension in `ENV_EXTENSIONS` when the
workspace is General or has no environment. General does have a container for
skills, MCP servers and user terminals; this exclusion keeps its agent's shell
and file tools off deliberately. Selection then gives an allow-all agent every
remaining tool or a restricted agent exactly its available grants. The read-only
tools resolve canonical paths inside `/home/dev/workspace`, use argv-based
execution, cap output and time out after 30 seconds. `git` exposes only
`status`, `log`, `diff`, `show`, `blame`, `branch`, and `remote`, and rejects
write/command-execution options; branch and remote arguments are restricted to
read-only operations, and git pathspecs are canonicalized. `web_fetch` and
`codemode` remain available in General when grants select them. New non-default
workspaces seed an allow-all **Build** agent and a **Plan** agent granted exactly
`read`, `grep`, `find`, `ls`, `git`, and `web_fetch`; Plan is not granted `codemode`.

Code mode runs model-written JavaScript in pi-codemode's QuickJS worker sandbox.
The script has no direct filesystem, shell, or network capability: its only
capability is calling tools already offered to that conversation as
`tools.<name>(args)`. Those calls run through the same container environment as
the corresponding tool, so code mode can read or execute shell only when the
agent is separately granted tools that allow it. It cannot call tools filtered
out for General, and Cake disables code mode's optional model-call tools.
`@earendil-works/pi-codemode@1.6.0` is a direct, exact backend dependency because
the backend constructs `CodemodeSandbox` directly; pi-durable also depends on it
transitively, but that does not make it an explicit dependency of Cake's code.

For a container workspace, `HarnessOptions.env` resolves durable conversation id →
chat thread → workspace → environment. `EnvironmentApi.start()` starts a stopped
or missing container and records the container id through the same path as the
environments API. One `Connection` and `RemoteExecutionEnv` is cached per
environment id, rooted at `/home/dev/workspace`; a lost connection is dropped and
all connections close with the backend. General and a workspace without an
environment return no `ExecutionEnv`: General's container runs skills and MCP
servers, never the agent's own tools.

The product image has no Docker CLI. `Connection` instead spawns the compiled
`environments/daemon-bridge` with Node. The bridge calls Docker through dockerode
and starts this exec as `dev`, with stdin/stdout/stderr attached and `Tty: false`:

```text
/home/dev/.local/share/cake/pi-env-1.6.0 serve --token <32 hex characters>
```

`Connection` generates the random token and appends those three serve arguments
to the bridge argv. The bridge forwards them unchanged. The daemon writes
`PI-ENV <token>\\n` first; `Connection` discards preceding noise, verifies that
sync line and then exchanges length-prefixed protocol 1 frames, beginning with
`hello { protocol: 1 }`. Docker's 8-byte non-TTY multiplex headers are removed by
`docker.modem.demuxStream`, so those frames are the only daemon stdout the client
sees. The token protects the stdio handshake; it is not an authorization secret.
No port or SSH connection is opened for tools.

Before the first connection, the backend inspects the container image's
architecture (`amd64` → `x64`, `arm64` → `arm64`, with the backend architecture as
fallback). It checks the versioned daemon path with `test -x`. If absent, it
streams the binary shipped by the npm package into an exec of `sh -c` which makes
the directory, writes a temporary file, applies mode `0755`, and renames it into
place. The daemon therefore runs on the container's glibc base without changing
the image.

`web_fetch` executes in the backend and never touches `api.env`. It permits only
public HTTP(S) destinations, resolves and checks every redirect hop (at most
five), uses GET with a 15-second timeout, and caps streamed output at 200 KB by
default or 1 MiB at most. DNS and literal-address checks reject local,
single-label, loopback, private, link-local, unique-local, CGNAT, unspecified and
multicast destinations, including IPv4-mapped IPv6. HTML is reduced to text;
JSON and other text are returned unchanged.

## What durable is (and is not)

- `Harness.open(storage, { models, registry, env, settings }, context)` owns
  conversations, submissions, tasks, checkpoints, compaction, tool calls,
  per-conversation agent config, usage accounting.
- It **runs the agent loop itself** — its own `pi.generation` / `pi.tool` tasks,
  models through `pi-ai`,   built-in `read` / `write` / `edit` / `bash` plus optional
  codemode and MCP. It is a **sibling** of `pi-coding-agent`, not a client of it.
- **No TUI and no second process required.** `pi-coding-agent` is not part of this
  architecture at all.
- **Not a service.** No HTTP surface, no auth, no multi-tenancy. `root.watch()`,
  `harness.watchTaskGraph()`, `watch()`, `observeConversation()` are in-process
  Chord observers. Shipping streamed ops to a browser means building the REST/WS
  layer in `apps/backend`; `ConversationTranscript` exists to make that sane.
- Durability: tasks are checkpointed, `harness.resume()` continues after a restart,
  `settings.restartLimit` (default 5) caps crash loops, `defineSignal()` + sleeps
  cover webhooks and human input, `api.memo` / `requestId` give idempotency.
- **Single writer per storage, no cross-process locking.** SQLite (WAL) or JSONL,
  one file per session. Two backend processes must never point at the same storage.
  The Postgres backend enforces this: the newest open becomes the only writer and an
  older process's commits fail with `WriterReplacedError` (`docs/postgres-adapter.md`).

## What we still write

- HTTP/WS API, auth, and the custom frontend.
- Domain logic around agents (the "extra functions" the backend needs).
- Config and secrets: model provider keys live in the backend, validated at
  startup. Currently `apps/backend/src/config.ts` has no secret handling.
- Container image and bootstrap.
- MCP and skill runtime wiring; tool policy itself is implemented.

## MCP

Do not write an MCP implementation. Two usable paths, in order of preference:

1. **In-container stdio, via `PipeTransport` + `openProcess`.** `pi-mcp`'s
   `PipeTransport` takes an `open(handlers)` callback and `pi-env`'s `openProcess()`
   returns a compatible `McpPipe` — no adapter. The server process is spawned by the
   daemon *inside the container*, so it sees the container's filesystem. The backend
   only speaks framing over the pipe. Wrap tools with `createMcpToolName()` and
   `toLlmContent()` (see the pi-mcp README for the `AgentTool` wrapper).
2. **In-container HTTP, via `StreamableHttpTransport({ url, headers })`.** Works, but
   you then own a port, auth and TLS for no capability the pipe does not give you.

A backend-spawned MCP server edits the **backend's** filesystem. That is only correct
for tools that act on backend-owned resources (its own DB, its own files). Tools do
not reach into the container by magic — only through an `ExecutionEnv` or
`openProcess`.

## Constraints and risks

- **Dependency weight.** `pi-durable` + `pi-ai` + `chord`, plus `pi-env` and `pi-mcp`
  as needed. AGENTS.md rule 4 makes that an explicit decision, not a default.
- **Experimental API.** Pre-1.0 churn. `AGENTS.md` already says not to assume any API
  here is stable.
- **Horizontal scaling.** One backend process per session store. Sharding must be
  decided before it is load-bearing (e.g. sessions pinned to a process).
- **Shutdown.** A harness keeps the process alive for timers; `close()` waits on task
  code. `SIGINT` / `SIGTERM` must close the harness, and startup must `resume()`.
- **Secrets.** Model keys in the backend. `.env*` stays out of Git (AGENTS.md #1).
  Already surfaced: HTTP response detail is env-gated, not secret-safe by accident.
- **Node.** Durable is ESM-only TypeScript; `pi-coding-agent` requires Node ≥ 22.19.
  We pin Node 26.13.1, fine.

## Open questions

1. **Storage choice** per environment: `openNodeSqliteStorage` (dev + single node), JSONL,
   or a Postgres adapter — see [`docs/postgres-adapter.md`](./postgres-adapter.md).
   Answered the narrow way: the backend always uses the Postgres adapter and has no
   in-process fallback; which file backend a single-node deployment might prefer is
   still open.
2. **Session → process mapping**, i.e. the sharding rule, once more than one backend
   instance exists.

Container transport and registry wiring are answered above. An end-to-end run
against a real container still needs to verify the packaged daemon's compatibility
with the workspace image; unit tests do not replace that deployment check.

## Remaining runtime validation

Validate in `apps/agent` (or a scratch workspace) — **not** `apps/backend`:

- two conversations with per-conversation `cwd` + `env`, one of them with `env` set to
  a `RemoteExecutionEnv` over a container daemon;
- one abort;
- a run killed mid-task, then `resume()`;
- `harness.watchTaskGraph()` and `root.watch()` piped to a WebSocket;
- one in-container stdio MCP server wrapped as `AgentTool` via `PipeTransport`.

Success = those six behave, and answers to open questions 1 and 2 are written back
into this file.
