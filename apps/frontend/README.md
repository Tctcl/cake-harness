# frontend

React + Vite web client for the tctcl platform.

**Status: chat shell.** Three panes and no top bar: conversations on the left with
an inline workspace picker at its foot, the live transcript in the middle, and
the open conversation's agent, model and spend on the right. It exercises the
durable chat routes end to end (see [`docs/durable.md`](../../docs/durable.md))
against the backend's `/threads/*`, `/workspaces` and `/agents` endpoints. Prompt
input, transcript, streaming, tool traces, creating and archiving workspaces and
renaming a conversation are real; editing an agent's capabilities is not built
here yet.

## Scripts

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `vite` | dev server with HMR |
| `build` | `tsc -b && vite build` | type-checks the project references, then bundles to `dist/` |
| `preview` | `vite preview` | serves the built `dist/` locally |
| `typecheck` | `tsc -p tsconfig.json --noEmit` | no emit |
| `lint` | `oxlint` | shared config from `@tctcl/oxlint-config/react.json` |
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
  them and the pane and the right sidebar render them. Nothing is fetched a
  second time to fill in the info panel.
- **The column has a reading width.** The transcript and the composer sit in a
  `max-w-3xl` column centred in the pane, so a wide window does not stretch a
  reply's measure, and tool payloads open inside that column rather than
  widening it.

## Settings

`src/components/settings/settings-page.tsx` is a screen, not a pane: opening it
from the account menu at the foot of the left sidebar replaces all three columns,
and the one control at the top of its section list brings them back untouched.
Sections run down the left — Tools, Skills, MCPs, Application settings, User
admin — and `Application settings` is the only one with something to change
today (the theme). The other three record capability that nothing enforces yet,
so they say what they are waiting for rather than drawing controls that edit a
list the run never reads.

The account menu (`src/components/layout/user-menu.tsx`) shows the name from
`GET /me` behind an initials mark, because there is no avatar upload and no
second account. Log out is present but disabled, with the reason: until sign-in
exists nothing can end a session (see `docs/deferred.md` §7).

## Layout

```text
index.html                        Vite entry document
vite.config.ts                    React, Tailwind, `@` alias, `/threads` + `/workspaces` dev proxy
vitest.config.ts                  shared React preset plus the `@` alias
components.json                   shadcn/ui preset (style, base colour, aliases)
docs/ai-elements.md               the AI Elements components, where each is used, what is unused
src/main.tsx                      React root (StrictMode)
src/App.tsx                       the shell: conversations left, chat centre, conversation info right; settings replaces it
src/components/layout/            sidebar.tsx (shell + resize), conversation-sidebar.tsx, workspace-picker.tsx,
                                  workspace-dialogs.tsx, thread-info.tsx, theme-picker.tsx, user-menu.tsx
src/components/settings/          settings-page.tsx: the full-screen settings sections
src/components/chat/              chat-pane.tsx, prompt-input.tsx, markdown.tsx, tool-trace.tsx
src/components/ui/                shadcn/ui + AI Elements primitives (see docs/ai-elements.md)
src/lib/chat-api.ts               typed fetches: threads, messages, stream path, workspaces, agents
src/lib/chat-store.ts             thread snapshots, streams, paging, optimistic sends
src/lib/theme.ts                  light/dark/system palette, stored and mirrored onto <html>
src/lib/utils.ts                  `cn()` — clsx + tailwind-merge
src/index.css                     Tailwind entry and theme tokens
src/test/setup.ts                 Testing Library setup (jest-dom matchers, cleanup)
```

## Configuration

- TypeScript: extends `@tctcl/typescript-config/vite.json`; build info is kept in
  `node_modules/.tmp/tsconfig.tsbuildinfo`.
- Lint: `.oxlintrc.json` extends `../../packages/oxlint-config/react.json`
  (React rules, browser environment).
- Tests: `vitest.config.ts` extends `@tctcl/vitest-config/react` (jsdom,
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
  `localStorage` under `tlabs-theme`, toggles `.dark` on `<html>`, and follows
  the media query while `system` is selected. The inline script in `index.html`
  applies the stored choice before the first paint so dark mode never flashes
  white. `theme-picker.tsx` is the control, in the left sidebar header.
- Dev proxy: `vite.config.ts` forwards `/threads` and `/workspaces` to
  `http://127.0.0.1:8080`, so the page reaches the backend without CORS.
- Environment variables: none defined. Vite only exposes variables prefixed with
  `VITE_`, and only when they are present in a `.env*` file at this package root.
