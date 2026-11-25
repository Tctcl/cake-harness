# Workspaces, agents and sessions

The entity model this platform is moving to, and the mechanism that keeps a
conversation coherent when the agent running it changes.

Status: **mixed.** The tool-execution section and previously landed slices
describe current code; the remaining lifecycle, switching and device sections
are targets, not claims about current behavior.

Scope: **backend and docs.** Parts of this document still describe proposed
lifecycle work. The tool-execution behavior below is implemented; later idle-stop,
reconciler and device sections remain proposals.

## Tool execution now

The harness stays in the backend. In a non-default workspace with an environment,
granted `read`, `write`, `edit` and `bash` tools operate through a pi-env daemon in
that workspace's container, as `dev` in `/home/dev/workspace`. The first run starts
a stopped container through `EnvironmentApi.start()` and deploys the versioned
daemon if needed. See [`docs/durable.md`](./durable.md) for the stdio bridge,
handshake and connection lifecycle.

The default General workspace has no container and never receives those
environment-backed tools. `web_fetch` is env-free and can be granted in every
workspace; it runs in the backend with public-address and redirect checks. Tool
grants are effective at conversation creation and before every submission: the
workspace is the ceiling, and an agent's selection is intersected with it. MCP,
skills and prompt catalog grants remain unwired.

A new non-default workspace defaults to `allowAll: false` with no grants. To let
its default Assistant use coding tools, open **Tools**, click **Sync from
registry**, select `read`, `write`, `edit`, `bash` (and `web_fetch` if wanted),
then **Save selection**. Alternatively enable **Reach every capability** on
**Overview** after syncing. The default agent's own `allowAll` then inherits that
workspace ceiling; a restricted agent also needs the corresponding agent grants.

## Why

Three things are coupled today that do not need to be. A workspace and a dev
container are separate entities (`workspaces.container` is a leftover column,
`dev_environments` is a table), an agent is a row a conversation points at and
never leaves, and a browser tab is the only client anyone thought about. Each
coupling costs a branch somewhere: a container that may or may not belong to a
session, a conversation that cannot change its mind, a UI that assumes it is the
only one looking.

The target is closer to how a coding harness is usually shaped: a workspace is
the machine and the ceilings, an agent is one way of working inside it, and a
conversation is a thread of work that may pass through more than one agent.

## The model

| entity | belongs to | notes |
| --- | --- | --- |
| workspace | owner | owns **exactly one** container, and the ceilings (tools, MCP servers, skills) |
| container | workspace | one per workspace, created with it, no separate lifecycle API |
| agent | workspace | a profile: name, prompt, instructions, capability selection, **model**, **thinking level** |
| conversation | workspace | carries the id of the agent **currently** running it, which may change |

Two invariants worth stating because they drive the code:

1. A workspace without a container is a broken workspace, not a valid state. If
   the container is gone, the workspace says so — it does not quietly run agents
   without one.
2. An agent never "needs" a container. Every agent has the workspace's container,
   because the workspace has one. `agents` and `dev_environments` stop having any
   relationship to decide.

## Agents

An agent stays a profile with its own capability selection (`tools`,
`mcp_servers`, `skills`) inside the workspace's ceilings, its own `system_prompt`
and `instructions`, and gains three columns it does not have: `allowed_models`,
`model` and `thinking_level`. Those are what a client changes when a user says
"use the cheaper model here" — settings, not identity.

Which models an agent may offer is decided by the workspace, not by the agent: a
workspace allows a subset of the credential store, and the agent picks inside that
subset. See [`docs/providers.md`](./providers.md) — that document also fixes how
spend is attributed, which is the same machinery as `model` (a credential, a
model, a price) seen from the other end.

Keeping the capability selection per agent is what makes **plan mode** and
**build mode** the same feature as any other agent: an agent whose selection is
read-only is a plan agent. No new concept, no mode flag on a conversation.

`agent.ts` stops holding `MODEL` as a constant and reads the active agent's
settings when it opens the harness.

## Conversations

`chat_threads.agent_id` stops being `NOT NULL` identity and becomes **the agent
in use**, changeable. The conversation itself is filed under the workspace, which
is what makes "switch the agent" possible without losing the thread.

A conversation may also carry its own overrides (model, thinking level) so that
changing one conversation's model does not rewrite the agent for every other
conversation using it. **Decided:** the agent holds the real settings; a
conversation override is written only when a user sets one for that conversation,
and switching agent **clears** it. A conversation therefore always starts from the
settings of the agent now running it — no model inherited from an agent that is no
longer there.

## Switching the agent mid-session

Switching is three steps, and only the first is new code:

1. **Restart the harness.** The `Supervisor` in `apps/backend/src/agent.ts` already
   does exactly this for a failed `Session`: `discard()` drops the instance, the
   next request reopens it over the same durable log. A settings change calls the
   same path, so "close the harness and recreate it with the new settings but the
   old session log" is a call, not a subsystem.
2. **Assemble the prompt per request** from the agent that is active *now*,
   rather than baking it into the harness at open. The prompt is a function of
   (agent, workspace ceilings), not of the log.
3. **Write a marker entry** into the conversation recording the switch: which
   agent, its instructions, and the fact that earlier turns ran under different
   ones.

The third step exists because of the problem the pivot creates: a conversation
that switches from a plan agent to a build agent still contains turns written
under the plan instructions, and the model reads them as its own. Two honest
answers were considered:

- **Per-request prompt plus a marker entry (decided).** The transcript records
  *that* the agent changed and what it became; the model is told plainly that
  earlier turns ran under other instructions. One entry per switch, no rewriting
  of history, and the setting can be changed again immediately.
- **Boundary entry only** — fold the restatement into the marker and stop
  assembling per request. Fewer moving parts, but then the prompt is a property
  of the log, and a second switch has to append again.

What is explicitly not done: silently swapping the instructions and letting the
model infer. That is the behaviour the pivot was meant to avoid.

The same mechanism serves a settings-only change — a new model or thinking level
with the same agent. It writes no marker, because the instructions did not change,
and it still restarts the harness, because the harness holds the model it opened
with.

## The container

- **The database row is the workspace; creating it starts nothing.** Workspace
  create writes the row. `workspaces.container` stops being a nullable jsonb
  holding a *reference* and becomes the container's identity and its last reported
  state.
- **It boots on demand** — on the first message in the workspace, or when someone
  presses "start". A workspace nobody talks to costs nothing, and the manual start
  is the same call for an operator who wants a shell before there is a
  conversation.
- **It stops itself when idle.** Idle means no SSH session, no message and no
  meaningful CPU for *n* minutes — the CPU floor matters because a ten-minute
  build sends no messages — where *n* is a per-workspace setting that can also be
  "never stop". Stopping is not deleting: volumes and the row stay, the next
  message boots it, and the reconciler re-establishes the declared state.
- **Health is observed and streamed, not inferred.** The backend polls the
  container's state and resource use (CPU, memory) and publishes it on the same
  event stream as everything else, so the frontend shows a live state rather than
  a value fetched on page load. This is what makes lazy boot honest: the workspace
  shows *starting*, *running* or *failed* instead of an empty terminal.
- **Changes to the environment go through the backend, not through the agent's
  shell.** Agents keep running commands inside the container — that is their job —
  but *changing* the environment (a tool version, a package, a service, an
  env var) is a request the agent sends to the backend, applied from the declared
  document and recorded as an entry.

Three consequences, decided rather than left to the implementation:

**A message that arrives while the container is stopped is held, not refused.** The
message is durable before the model runs, so the turn becomes *waiting for
container*, runs when the container reports *running*, and reports a stated failure
if it never does. Refusing would throw away what the user typed and teach them
nothing; the row exists in either case, so the workspace is never lost.

**A change request is queued into the declared document, not applied beside it.**
The reconciler stays the only writer of the environment, so there is one code path
whether the change came from an agent or from an operator, and no window where the
document and the container disagree. The request returns the projected plan — what
would change — and the applied result arrives as an entry.

**"Idle" means no message, no SSH session and no meaningful CPU.** Two clocks, not
one: a ten-minute `pnpm build` sends no messages and is obviously not idle. The CPU
floor is nearly free to observe because health is already being sampled for the
stream, and it is the difference between a workspace that stops under a running
build and one that does not.

A fourth is inherited rather than decided here: **one turn at a time per
conversation**. The supervisor already single-flights a reopen
(`Supervisor` in `apps/backend/src/agent.ts`), and appends go through the durable log, so a
second device's message queues behind the running turn instead of interleaving with
it. Two devices therefore cost one turn each, in order — which is also what makes
per-call usage rows unambiguous.

The last point is not about sandboxing the agent. It is what keeps the declared
and actual state from drifting: the reconciler's whole premise is that the
document is the truth, so a change made by a `apt-get install` the document never
saw is reverted on the next apply and looks like a bug. Funnelling mutations
through the backend makes each one a visible, attributable, reviewable record —
the same path an operator's change takes, with the same audit trail. SSH remains
the human's door, and an SSH user is precisely the signal that a human is present.

## Multiple devices

One account is expected to be signed in on several clients at once — a laptop, a
phone, a second browser — and to move between them mid-conversation. Two
consequences:

**Changes must reach other clients.** A switch, a rename, a settings change or a
new message cannot be something only the tab that caused it ever learns. The
backend serves one event stream per client (`GET /events`, server-sent events
over the existing Fastify reply, no new dependency) and broadcasts the same
events to every session of the owner. SSE rather than WebSocket because every
event here flows one way; actions stay ordinary requests.

**Devices are named and revocable.** Today `sessions` records a token hash and a
`last_seen_at`, which is enough to authenticate and useless to a human. The plan:

- a `devices` table: id, user id, name, first seen, last seen, revoked at;
- `sessions.device_id`, so revoking a device drops the sessions that belong to
  it;
- the first sign-in from an unrecognised device opens a half-authenticated
  session that may do nothing but name the device — the same shape as the
  existing `must_change_password` and second-factor steps;
- Settings → Devices lists them with last-seen times and a "sign out" action per
  device.

Recognising a device is a cookie set at first sign-in (a device token, separate
from the session token, so signing out does not orphan the device's identity).
Nothing about the browser is fingerprinted: the cookie *is* the identity, and a
fingerprint is only ever a display hint.

## Order of work

1. This document.
2. Migration and entity change: `dev_environments` folds into the workspace
   (container id, image, reported state) and the environment routes move under
   `/workspaces/:id/container`. Container creation moves out of its own route into
   workspace create, which now only writes the row.

   *Landed ahead of the fold (2026-08):* creation moved into workspace create. A
   workspace now comes with exactly one environment in the same transaction, a
   unique index on `workspace_environments.workspace_id` holds it to one, and the
   routes refuse a second attach (`409 ENVIRONMENT_ALREADY_ATTACHED`), a detach
   (`409 ENVIRONMENT_REQUIRED`) and the deletion of an environment a workspace
   runs in (`409 ENVIRONMENT_IN_USE`). The default workspace is the exception: it
   has no container and can use only env-free tools. The fold itself — one table, one
   id — is still ahead, so `dev_environments` remains a separate table reached by
   `environment_id`.
3. Lazy boot and state streaming: the container starts on the first run that
   resolves its execution environment or on an explicit start. Idle stopping and
   broadcasting state are still ahead.
4. Agent settings: `allowed_models`, `model` and `thinking_level` on `agents`,
   read at harness open, `discard()` on change.
5. Conversations: `agent_id` becomes the active agent, the switch route, the
   marker entry, per-request prompt assembly.
6. Credentials and spend: `workspace_credentials`, usage rows, the three meters
   (see [`docs/providers.md`](./providers.md)).
7. Devices: the table, the naming step, the settings screen, session revocation.
8. Events: `GET /events` and a broadcast on every mutation another client cares
   about. The client that consumes it is the owner's change, not this one.

Steps 4 and 5 are the vertical slice that proves the idea; 2, 3, 6, 7 and 8 are
mechanical once the shape is agreed, though 6 is the one with external API risk.

## What this deletes

- `dev_environments` and its repository, routes, schemas and tests; the manifest
  and state endpoints move to a workspace id.
- `workspaces.container` as a nullable jsonb holding a container *reference* —
  it becomes the workspace's container or nothing.
- The environment picker in the frontend, and the "which environment is this
  session in" question in the API.
- `MODEL` as a module constant in `apps/backend/src/agent.ts`, and `createModels`
  opening the provider from a process-wide key: which credential pays becomes a
  per-workspace question.
- Any path where an agent's shell is the way the environment is changed.

## Open

- **Does the switch interrupt a running turn?** A turn in flight belongs to the
  old agent; refusing the switch until it finishes is simpler and predictable.
- **Marker entry shape.** Whether it is a `system` entry with rendered text, or a
  dedicated entry kind the UI renders as a divider. A dedicated kind keeps the
  model's context clean and the transcript readable; the cost is touching the
  entry union and teaching every reader — model context, transcript, export — to
  skip it.

