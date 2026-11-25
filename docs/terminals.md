# Terminals

A terminal is a program running in the environment's container, reachable from the
browser. It is not a second execution mechanism: the bytes travel through
`docker exec` with a TTY allocated, so the program is the same one a person would
get from `docker exec -it tctcl-env-<id> /bin/sh`, with the environment's own shell,
user and working directory.

This document is the contract. `apps/backend/src/terminal/contract.ts` holds the
types that go on the wire, and the frontend implements against nothing else.

## What a session is

Three things, one per concern:

| Layer | Module | Owns |
| --- | --- | --- |
| Bytes | `apps/backend/src/terminal/pty.ts` | one `docker exec` with `Tty: true`, and its death |
| Bookkeeping | `apps/backend/src/terminal/sessions.ts` | sessions, scrollback, limits, idle reaping |
| Transport | `apps/backend/src/routes/terminals.ts` | HTTP routes, the socket, the frames |

Splitting them is what makes the bookkeeping testable: `server.inject()` cannot
open a PTY, so the routes are tested against a fake `PtyFactory` and the pump is
tested against a fake `Pty`.

A session survives its client on purpose. Closing the panel must not kill a
running build, and reattaching must not start from a blank screen.

## Routes

All of them are mounted under
`/workspaces/:workspaceId/environments/:environmentId/terminals` because a
terminal is a use of an environment, not a thing of its own: it dies with the
environment and inherits its identity. The container id never crosses this
boundary — a client names an environment and a session.

| Route | Body | Answer |
| --- | --- | --- |
| `GET …/terminals` | — | `{ "terminals": [{ "id", "label", "createdAt", "size", "attached", "environmentId" }] }`, oldest first |
| `POST …/terminals` | `{ "label"?, "size"?: { "cols", "rows" } }` | `201` and the session |
| `DELETE …/terminals/:terminalId` | — | `204` once the process is gone |
| `GET …/terminals/:terminalId/attach` | — | a websocket, `101` |

Every route requires `environments.create`. Opening a shell in a container is at
least as privileged as creating one, so it reuses that permission rather than
adding a role grant nobody has yet. Auth is the existing path: `registerActor`
resolves the cookie for these routes like every other, and the attach socket is
the same origin as the page, so the browser sends the same cookie on the upgrade.
There is no token in the URL and no second authorization path.

### Why a websocket

The alternative was SSE down and `POST` up. A websocket wins on one point: the
browser reads and writes the same socket, so a keystroke does not wait for a
round of framing, and close/error events arrive in one place. It costs one
dependency, `@fastify/websocket`, which is a thin wrapper over `ws` — the
upgrade plumbing Fastify does not ship and Node cannot be asked for directly.
`dockerode` was already installed, so the only new package is the transport.

## Frames

Binary frames are terminal bytes in **both** directions and are never parsed.
Text frames are JSON control messages. That split is what keeps a paste of ten
kilobytes of escape sequences intact: output is never decoded, re-encoded or
merged with metadata.

Server → client, text:

```json
{ "type": "ready", "terminal": { "id", "label", "createdAt", "size", "attached", "environmentId" } }
{ "type": "exit", "code": 0, "signal": null }
{ "type": "error", "code": "TERMINAL_BUSY", "message": "..." }
```

Client → server, text:

```json
{ "type": "resize", "cols": 120, "rows": 40 }
```

Order on attach is fixed: `ready`, then the replay as one binary frame if
anything was buffered, then live bytes. The client sizes its emulator from
`ready.terminal.size` before the replay arrives, so a full-screen program's
cursor addressing lands in the right place.

Close codes: `1000` the program exited (after an `exit` frame), `4404` that
session does not exist (gone, or the backend restarted), `4409` the environment
is not running or another client is attached.

## Lifetime

| Event | What happens |
| --- | --- |
| `POST` | A PTY is opened inside the container. `409 ENVIRONMENT_STOPPED` if the environment is not running, `409 TERMINAL_LIMIT_REACHED` at the cap. |
| Program exits | Session stays in the list with its scrollback until closed, and `attach` answers `409 TERMINAL_EXITED`. |
| `DELETE` | EOF, then `SIGTERM` to the process group, then `SIGKILL`. The route answers `204` only once nothing is running. |
| Environment stops | `closeEnvironment` runs before the container is stopped, so no shell outlives it. |
| Client disconnects | The session stays. It is reaped after `TERMINAL_IDLE_TIMEOUT_MS` with no client and no traffic. |
| Backend restarts | Sessions are in memory, so they are gone: `attach` answers `4404` and the client must list again and create a new one. The `docker exec` processes die with their sockets. |

Limits, read once in `apps/backend/src/config.ts`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TERMINAL_MAX_SESSIONS` | `8` | Sessions one environment may hold |
| `TERMINAL_SCROLLBACK_BYTES` | `262144` | Output replayed on reattach, per session |
| `TERMINAL_IDLE_TIMEOUT_MS` | `1800000` | Reap a session with no client attached; `0` never reaps |

## Resize and escape sequences

Neither end interprets anything.

- Escape sequences come from the program inside the container and go to the
  emulator as bytes. The backend does not parse, strip or translate them, which
  is why `vim`, `less` and `top` work without a special case.
- The PTY is created with the size the client asked for at `POST` (default
  `80x24`), so the first program that asks for the window size gets a truthful
  answer instead of `0x0`.
- A resize is a `resize` frame. It is clamped to `2..500` columns and `1..300`
  rows rather than refused: a window drag sends a frame per pixel, and an error
  would only ask the client to retry. The client should send one on open, on
  every drag frame, and when a tab becomes active again — the emulator's own
  fit addon already knows the size it wants.
- `TERM` is set to `xterm-256color` and `COLORTERM` to `truecolor` for the session,
  because a program that guesses `dumb` will not draw a cursor.

## Concurrency

One client per session. A dockerode hijacked stream has no way to demultiplex
two writers, so a second attach is refused with `409 TERMINAL_BUSY` (or close
code `4409`) rather than let two keyboards interleave. Two tabs on the same
session is a client bug, not a feature to support; two tabs mean two sessions.

## Tests

`apps/backend/src/terminal/sessions.test.ts` covers the bookkeeping — labels,
replay, the cap, the exit path, the reaper and close — against a fake `Pty`.
`apps/backend/src/routes/terminals.test.ts` covers the routes through
`server.inject()` against a fake `PtyFactory`: `201`, `204`, `404` for an
unknown environment or a session from another one, `409` for a stopped
environment and for the cap. The socket itself is not tested through `inject`:
the frontend's `apps/frontend/src/lib/terminal-api.ts` will drive the frames, and
a PTY cannot be faked inside the HTTP request cycle.
