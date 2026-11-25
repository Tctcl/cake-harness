# frontend

React + Vite web client for Cake.

**Status: chat shell.** Every conversation of every workspace on the left, grouped
under the workspace it belongs to and folded by clicking that heading, a topbar
over the chat, the live transcript in the middle, and a right column the topbar
fills — with the open conversation's workspace, container, agent, model and
spend, or with a terminal. Nothing shown on the right means no right column at
all. It exercises the durable chat routes end to end
(see [`docs/durable.md`](../../docs/durable.md)) against the backend's
`/threads/*`, `/workspaces` and `/agents` endpoints. Prompt input, transcript,
streaming, tool traces, adding and archiving workspaces in settings and renaming
a conversation are real; the terminal draws, but no session is attached to it
yet; editing an agent's capabilities is not built here yet.

## Scripts

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `vite` | dev server with HMR |
| `build` | `tsc -b && vite build` | type-checks the project references, then bundles to `dist/` |
| `preview` | `vite preview` | serves the built `dist/` locally |
| `typecheck` | `tsc -p tsconfig.json --noEmit` | no emit |
| `lint` | `oxlint` | shared config from `@cake-harness/oxlint-config/react.json` |
| `test` | `vitest run` | jsdom + Testing Library, one-shot run |
| `test:watch` | `vitest` | watch mode |

## Running

```bash
pnpm dev:frontend         # from the repo root, with pnpm dev:backend in another shell
# or
pnpm --filter frontend dev
```

Vite prints the local URL (default `http://localhost:5173`). Without the backend
the panes report the failure instead of rendering a transcript.

## How the chat pane works

- **One stream per conversation, owned outside React.** `src/lib/chat-store.ts`
  keeps a module-level map of thread id → snapshot + `EventSource` + listeners.
  Selecting a conversation opens `/threads/:threadId/stream` once; switching to
  another conversation unmounts `ChatPane` but leaves the stream running, so
  clicking back is instant and a run that started earlier keeps delivering.
  Components read through `useSyncExternalStore` (`snapshotOf` /
  `subscribeToThread`), so the store stays the single source of truth.
- **Paged, not fully loaded.** The newest page is read from
  `GET /threads/:threadId/messages`; older pages are fetched by cursor only when
  the scroller reaches the top (`loadOlder`). `mergeMessages` folds both
  directions together — a streamed line wins over an older copy of the same id
  (a partial answer growing into the final one) and lines the window does not
  carry survive.
- **It follows the newest line until you scroll up.** The transcript is pinned to
  the bottom by default, and growth — a new message, the live turn getting longer,
  a tool call added — scrolls it back down. Scrolling up unpins it, so reading
  older lines is never interrupted, and a *Jump to newest* button appears at the
  bottom of the pane: pressing it scrolls to the end and pins again. Switching
  conversation remounts the transcript (keyed on the thread id), so each one opens
  at its newest line.
- **Sending is optimistic.** `send` shows the typed line immediately, `POST
  /threads/:threadId/messages`, and drops the optimistic row once the stream
  delivers the stored entry. A failure marks the row "Not sent" with a Retry
  that re-posts the same text under the same local id.
- **The work in flight is visible.** Every frame carries `live`: the answer's
  blocks as the provider writes them (reasoning, then text, then the calls whose
  arguments are still arriving), the current tool round's slots with the output
  each has published so far, the rounds taken, running compactions, and the
  reason the last run died. `live-run.tsx` renders that in order — reasoning in a
  `Reasoning` panel, text as markdown, calls as one line each, running tools as
  open slots — so nothing the model does is hidden behind a spinner. An idle
  conversation carries an empty `live`, which is how the view tells "working"
  from "waiting for you".
- **Stream status is visible.** `connecting` / `live` / `error` live in the
  snapshot and drive the error line above the composer; `EventSource` reconnects
  on its own, so a broken stream is reported, not re-created by hand.
- **A frame is the whole visible state.** Besides the messages, every frame
  carries the run's tool calls, the model and provider that answered, the
  conversation's token and cost totals, and the live activity; the snapshot keeps
  them and the pane and the info panel render them. Nothing is fetched a
  second time to fill in the info panel.
- **The column has a reading width.** The transcript and the composer sit in a
  `max-w-3xl` column centred in the pane, so a wide window does not stretch a
  reply's measure, and tool payloads open inside that column rather than
  widening it.

## The conversation list

`src/components/layout/session-list.tsx` renders every conversation of every
workspace, grouped under a heading per workspace, in the order the backend returns
them. The heading is gray, carries a down chevron while its group is open and a
right chevron while it is folded, and clicking it folds the group away; the +
at the end of the heading starts a conversation in that workspace and reopens the
group if it was shut. Folded groups are remembered in `localStorage`
(`src/lib/workspace-groups.ts`, key `cake-collapsed-workspaces`) because that is
how this browser is reading the list, not what the list is.

The order is the user's and lives in the database: a new workspace takes position
0 and pushes the rest down, and dragging a heading onto another rewrites the whole
order with `PUT /workspaces/order`. The move shows immediately and is put back if
the server refuses it, because the stored order is what survives a reload. There
is no workspace selector any more — the conversation names its workspace, so the
heading is a label and a fold, never a filter — and adding, renaming or archiving
a workspace happens in the workspace manager (account menu → Workspaces).

## Settings

`src/components/settings/settings-page.tsx` is a screen, not a pane: opening it
from the account menu at the foot of the left sidebar replaces all three columns,
and the one control at the top of its section list brings them back untouched.
Sections run down the left — Application settings and User admin — and both have
something to show: the theme, and the single local user.

Everything that belongs to a workspace is *not* here. An MCP server, a skill, a
prompt, a tool, an environment and a provider login only mean anything inside the
workspace whose container runs them, so the sections that listed them globally
are gone and the workspace manager owns them instead.

## Workspace manager

`src/components/workspaces/workspaces-page.tsx` is the second full-screen
screen, opened from the same account menu (Workspaces). The list on the left is
every workspace with the form that adds one; the right side is the workspace
selected out of that list and stays a placeholder until one is picked, so nothing
is loaded for a workspace nobody asked about. Switching workspaces remounts the
detail (`key` on the id), which is what starts the next one on Overview rather
than on the tab the last one was left on.

The detail (`workspace-detail.tsx`) is a tab per concern, Overview first:

- **Overview** — `workspace-overview.tsx`: rename, describe and archive it.
- **Environment** — `workspace-environment.tsx`: the container the workspace runs
  in and the image it is created from (`GET /workspaces/:id/environments`, then
  `PATCH /environments/:id`). A workspace attached to no environment says so
  instead of drawing an empty form.
- **Tools, Skills, Prompts** — `workspace-capabilities.tsx`: the catalogs, with
  what the workspace grants.
- **MCP** — `workspace-mcp.tsx`: the servers started in this workspace's
  container. Transport is `stdio` (one text box per word of the command line, so
  `["npx", "-y", "example-mcp-server"]` is three boxes) or `http` (a URL), plus
  working directory and environment variables for the local case.
- **Providers** — `workspace-providers.tsx`: the logins this workspace may use and
  the models behind them, allowed or disallowed one by one. Two keys on one
  provider are one row with a count, because the models hang off the provider, not
  off the key; a new key is created globally and linked here.

The MCP and Providers tabs speak to endpoints the backend does not serve yet
(`/workspaces/:id/mcp-servers`, `/providers`, `/workspaces/:id/providers`); the
screens are built and the calls fail loudly until those routes exist. Today's
backend keeps MCP servers and provider credentials in global tables
(`docs/capabilities.md`, `docs/providers.md`) with no workspace column.

Nothing renders until `AuthGate` (`src/components/auth/auth-gate.tsx`) has read
`GET /auth/session`. A single-user install answers with the owner and passes
straight through. An install with accounts shows the sign-in form, then any step
the session still owes: a password an admin set, or a second factor. Any call that
later answers `401 auth.unauthenticated` fires `cake:signed-out` from
`src/lib/http.ts`, and the gate shows the form again, so no screen handles a lost
session on its own. Enrolling a second factor has no screen yet (`docs/auth.md`).

The account menu (`src/components/layout/user-menu.tsx`) shows the name from
`GET /me` behind an initials mark, because there is no avatar upload. Sign out
ends the session. In single-user mode it is shown disabled, with the reason.

## Topbar and right panel

`src/components/layout/topbar.tsx` is the strip above the chat and the right
column: the open conversation's name on the left (click it to rename, which is
where renaming lives now), and on the right three toggles — a list icon for
conversation info (`thread-info.tsx`), a terminal icon for `terminal-panel.tsx`,
and a chart icon for what the workspace's providers have cost
(`provider-usage.tsx`). The panel is one place with changing content rather than
three fixed columns: clicking the active toggle again empties it, and an empty
panel is not mounted at all, so the chat takes the full width and no collapsed
rail is left behind. The panel sits on `bg-background` — the same canvas as the
chat — and keeps a `border-l`; the separator between columns is that 1px border,
while the resize strip is an invisible grab area over it.

Conversation info is a column of collapsible sections — `Conversation`,
`Environment`, `Context`, and `SSH`. The workspace Environment tab holds the
full SSH setup: generated or uploaded keys are managed in Settings, and a
workspace-specific config block opens `/home/dev/workspace` through VS Code
Remote-SSH. Its listening-port list is polled while visible and provides
copyable SSH forwarding commands; development ports are not published directly.

Every sidebar declares its own resize range and opening width in
`SIDEBAR_WIDTHS` (`src/App.tsx`): `min`/`max` bound what a drag can produce and
`open` is the width it is created at. Each right panel remembers the width it was
dragged to, so switching panels does not reset the one you just left.

The terminal is `@xterm/xterm` with the fit addon, one emulator per session so
scrollback survives a tab switch, and a tab strip at the top of the panel for
switching and adding sessions. Sessions are the backend's, not the panel's: the
panel lists what the workspace's environment already has, opening a tab calls
`POST …/terminals` and closing one calls `DELETE`, and a hidden tab keeps its
socket so output arriving in the background is not lost. The socket path and the
frame shapes are in `src/lib/terminal-api.ts`; the protocol is
`docs/terminals.md`. Attaching happens in two steps the server controls — a
`ready` frame with the session's size, then the retained scrollback as one
binary frame before live output — so a full-screen program's first bytes land at
the right width. Sizing is reported on mount, on every fit and again when a tab
is shown, because a hidden element measures 0×0 and the backend clamps that to
1×1 rather than keeping the old size.

## Layout

```text
index.html                        Vite entry document
vite.config.ts                    React, Tailwind, `@` alias, a dev proxy entry for every backend route prefix
vitest.config.ts                  shared React preset plus the `@` alias
components.json                   shadcn/ui preset (style, base colour, aliases)
docs/ai-elements.md               the AI Elements components, where each is used, what is unused
src/main.tsx                      React root (StrictMode): the sign-in gate around the shell
src/components/auth/              auth-gate.tsx: session check, sign-in, second factor, initial password
src/App.tsx                       the shell: conversations left, topbar + chat + right panel; settings and the
                                  workspace manager replace it
src/components/layout/            sidebar.tsx (shell + resize + SidebarWidths), session-list.tsx
                                  (workspace groups + conversations), topbar.tsx, right-panel.tsx,
                                  thread-info.tsx, info-section.tsx (collapsible section + rule),
                                  environment-card.tsx, ssh-card.tsx, provider-usage.tsx,
                                  agent-environment.tsx, terminal-panel.tsx, theme-picker.tsx, user-menu.tsx
src/components/settings/          settings-page.tsx: the full-screen settings sections (app, user)
src/components/workspaces/        workspaces-page.tsx (list + detail screen), workspace-detail.tsx (tabs),
                                  workspace-overview.tsx, workspace-environment.tsx,
                                  workspace-capabilities.tsx, workspace-mcp.tsx, workspace-providers.tsx
src/components/chat/              chat-pane.tsx, prompt-input.tsx, markdown.tsx, tool-trace.tsx
src/components/ui/                shadcn/ui + AI Elements primitives (see docs/ai-elements.md)
src/lib/http.ts                   one fetch helper: status before body, HttpError, the signed-out event
src/lib/auth-api.ts               session, sign-in, sign-out, second factor, initial password
src/lib/chat-api.ts               typed fetches: threads, messages, stream path, workspaces, agents
src/lib/capability-api.ts         tools, skill and prompt catalogs, workspace MCP servers, grants
src/lib/environment-api.ts        environments, the workspace's container and an agent's environment
src/lib/provider-api.ts           provider logins, their models, what a workspace links and allows
src/lib/terminal-api.ts           terminal sessions and the socket protocol
src/lib/update-api.ts             the update notice
src/lib/chat-store.ts             thread snapshots, streams, paging, optimistic sends
src/lib/theme.ts                  light/dark/system palette, stored and mirrored onto <html>
src/lib/workspace-groups.ts       which workspace groups are folded, stored per browser
src/lib/utils.ts                  `cn()` — clsx + tailwind-merge
src/index.css                     Tailwind entry and theme tokens
src/test/setup.ts                 Testing Library setup (jest-dom matchers, cleanup)
```

## Configuration

- TypeScript: extends `@cake-harness/typescript-config/vite.json`; build info is kept in
  `node_modules/.tmp/tsconfig.tsbuildinfo`.
- Lint: `.oxlintrc.json` extends `../../packages/oxlint-config/react.json`
  (React rules, browser environment).
- Tests: `vitest.config.ts` extends `@cake-harness/vitest-config/react` (jsdom,
  Testing Library, jest-dom matchers, and a setup file that unmounts between
  tests) and adds the `@` alias the shadcn components import through. Test files
  are `src/**/*.test.ts` and `src/**/*.test.tsx`.
- `@` resolves to `src/` (alias in `vite.config.ts`, `vitest.config.ts` and
  `tsconfig.json`).
- Styling: Tailwind CSS v4 through `@tailwindcss/vite` — no `tailwind.config.js`;
  theme tokens live in `src/index.css`. Components follow the shadcn/ui
  "new-york" preset recorded in `components.json`, so new primitives come from
  the shadcn CLI (registry `@ai-elements`) rather than being hand-written.
  Dependencies: React 19, `@radix-ui/*`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `lucide-react`, `streamdown`, `shiki`, `tw-animate-css`.
  The registry's `motion` and `@streamdown/*` extras are not installed: the one
  component that wanted them (`reasoning.tsx`) uses the stylesheet's `.shimmer`
  class and plain `streamdown` instead.
- Fonts: `@fontsource-variable/inter` for the interface and
  `@fontsource-variable/jetbrains-mono` for code, imported in `src/index.css`;
  replies are set in the serif stack. Nothing is fetched from a CDN.
- Theme: `src/lib/theme.ts` stores `light`, `dark` or `system` in
  `localStorage` under `cake-theme`, toggles `.dark` on `<html>`, and follows
  the media query while `system` is selected. The inline script in `index.html`
  applies the stored choice before the first paint so dark mode never flashes
  white. `theme-picker.tsx` is the control, in the left sidebar header.
- Dev proxy: `vite.config.ts` forwards `/threads` and `/workspaces` to
  `http://127.0.0.1:8080`, so the page reaches the backend without CORS. Both
  entries are objects with `ws: true`, which is what makes the development
  server forward the terminal attach upgrade instead of answering it with a 404.
- Environment variables: none defined. Vite only exposes variables prefixed with
  `VITE_`, and only when they are present in a `.env*` file at this package root.
