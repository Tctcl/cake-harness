# Agent runtime: pi-durable in the backend

Research notes and the architecture decision for running agents in this platform.
Written so an agent (human or AI) can pick this up without re-reading upstream.

Status: **chat slice over Postgres.** `apps/backend` runs a durable `Harness` over
the Postgres adapter ([`docs/postgres-adapter.md`](./postgres-adapter.md)), keeps
one conversation per row of `chat_threads`, and serves it through
`/threads/:threadId/messages` with `opencode-go`/`deepseek-v4.1-flash`. A thread is
filed under a `workspaces` row and an `agents` row, but the selection is still
bookkeeping: the harness runs with no tools and no MCP either way. There are no
tools and no streaming, and `apps/agent` still prints `Hello, World!`.

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
  tools: builtin + mcp_*  ───────────────────►   MCP stdio servers run here
  HTTP/WS API for our own frontend
```

Rejected alternative: running pi (RPC mode or SDK) inside the agent app and having
the backend orchestrate. That produces two agent loops, no atomicity between
backend state and agent state, and a control protocol we would have to invent.

## What durable is (and is not)

- `Harness.open(storage, { models, registry, env, settings }, context)` owns
  conversations, submissions, tasks, checkpoints, compaction, tool calls,
  per-conversation agent config, usage accounting.
- It **runs the agent loop itself** — its own `pi.generation` / `pi.tool` tasks,
  models through `pi-ai`, built-in `read` / `write` / `edit` / `bash` plus optional
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
- Container image and pi-env daemon deployment.
- Tool policy (which tools per conversation, which hosts).

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

## Open questions — resolve before writing backend code

1. **Container transport.** pi-env's documented path is SSH (`connectSsh`, host-key
   pinning) or `localDaemon()` on the same machine. The underlying `Connection` takes
   a spawn command and the daemon speaks framed stdin/stdout, so
   `docker exec -i <container> pi-env` (or a K8s exec) *should* work — decides whether
   the image needs `sshd`.
2. **Registry wiring.** How `Harness.open(...)`'s `registry` plus per-conversation
   config accepts our `mcp_*` `AgentTool`s, and how `env` is pinned to the remote
   `RemoteExecutionEnv`.
3. **Storage choice** per environment: `openNodeSqliteStorage` (dev + single node), JSONL,
   or a Postgres adapter — see [`docs/postgres-adapter.md`](./postgres-adapter.md).
   Answered the narrow way: the backend always uses the Postgres adapter and has no
   in-process fallback; which file backend a single-node deployment might prefer is
   still open.
4. **Session → process mapping**, i.e. the sharding rule, once more than one backend
   instance exists.

## Spike plan (not done)

Validate in `apps/agent` (or a scratch workspace) — **not** `apps/backend`:

- two conversations with per-conversation `cwd` + `env`, one of them with `env` set to
  a `RemoteExecutionEnv` over a container daemon;
- one abort;
- a run killed mid-task, then `resume()`;
- `harness.watchTaskGraph()` and `root.watch()` piped to a WebSocket;
- one in-container stdio MCP server wrapped as `AgentTool` via `PipeTransport`.

Success = those six behave, and answers to open questions 1 and 2 are written back
into this file.
