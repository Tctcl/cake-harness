# AI Elements in this app

The chat surface is built from [AI Elements](https://ai-sdk.dev/elements) — the
chat components published in the shadcn registry under `@ai-elements`. They are
vendored source: installed with the shadcn CLI, checked into
`src/components/ui/`, and styled by the same Tailwind tokens as the rest of the
app, so they can be edited where Cake needs something different.

Everything in the first table is rendered by the running screen. Components
that are installed but waiting on backend capabilities are listed separately so
they are not mistaken for features.

## Used in the running UI

| Component | Where | What it does here |
| --- | --- | --- |
| `Message` (`Message`, `MessageContent`) | `src/components/chat/chat-pane.tsx` | One transcript entry: alignment by role, markdown body for the agent, bubble for the person. |
| `MessageScroller` (`MessageScrollerProvider`, `MessageScroller`, `MessageScrollerViewport`, `MessageScrollerContent`, `MessageScrollerItem`, `MessageScrollerButton`) | `src/components/chat/chat-pane.tsx` | The transcript scroller. `autoScroll` sticks to the bottom while an answer streams, `preserveScrollOnPrepend` keeps the reading position when an older page is prepended, and `MessageScrollerButton` is the jump-to-latest affordance. Paging is driven from `onScroll`: the viewport asks for the next page while `scrollTop` is under `LOAD_OLDER_THRESHOLD` (160px). |
| `Bubble` (`Bubble`, `BubbleContent`) | `src/components/chat/chat-pane.tsx` | The person's line, both stored turns and the optimistic row that shows "Sending" / "Not sent" with Retry. |
| `CodeBlock` | `src/components/chat/markdown.tsx` | Wraps fenced code in a reply with its language label and copy button. |
| `Spinner` | `src/components/chat/chat-pane.tsx` | First-page load and the "Sending" row of an optimistic line. |
| `Reasoning` (`Reasoning`, `ReasoningTrigger`, `ReasoningContent`) | `src/components/chat/live-run.tsx` | The model's own reasoning while it works: open while it streams, collapsed a second after it lands, with the measured duration in the trigger. Text arrives redacted from some providers; the block says so instead of showing nothing. |
| `Empty` (`Empty`, `EmptyHeader`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`, `EmptyMedia`) | `src/components/chat/chat-pane.tsx`, `session-list.tsx` | Placeholder states: no conversation selected, no workspaces yet. |
| `Tooltip` (`TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent`) | `src/App.tsx` (provider), `sidebar.tsx`, `session-list.tsx`, `theme-picker.tsx` | Collapse and expand hints on the sidebar buttons, the new-conversation button, the theme control, and the full title of a truncated workspace name or thread. |
| `ScrollArea` | `src/components/layout/sidebar.tsx` | Scrolls each sidebar's content inside its fixed width, so the list never grows the shell. |
| `Separator` | `src/components/workspaces/workspace-capabilities.tsx`, `workspace-providers.tsx` | Dividers between the groups of a workspace tab. |
| `Badge` | `src/components/workspaces/` (detail, environment, MCP, providers), `src/components/settings/credentials-page.tsx` | Status and kind chips: the "Default" workspace, an environment's state, a server's transport, a key's provider. |
| `Trace` (`Trace`, `TraceCollapsible`, `TraceCollapsibleTrigger`, `TraceCollapsibleContent`, `TraceLine`, `TraceIcon`, `TraceTitle`, `TraceDescription`) | `src/components/chat/tool-trace.tsx` | The run's tool calls under the reply: one collapsed line per call with its status and duration, arguments and result opening underneath. |
| `Button`, `Textarea`, `Input`, `Label` | throughout | shadcn/ui primitives the AI Elements and the composer build on. |

The composer (`src/components/chat/prompt-input.tsx`) is **not** an AI Element:
it is a small local component over `Textarea` + `Button`, because the registry's
`PromptInput` brings attachments and a model selector this slice has no backend
for. Replacing it is the natural next step once uploads exist.

## Not vendored

`Attachment`, `Dialog`, `Marker`, `Popover` and `Select` were installed and never rendered, so they
were removed. File uploads (`Attachment`) need an upload route and somewhere to put the bytes; when one exists,
add the component again with the shadcn CLI rather than keeping unused source in the tree.

One component is vendored with deliberate reductions: `reasoning.tsx` keeps the
registry's API but draws the shimmer with the stylesheet's `.shimmer` class
instead of `motion`, and renders through plain `streamdown` rather than pulling
in the cjk, math and mermaid plugins for text the model reasons in.

Keep this file in step with the code: a component is vendored when the UI renders it, and it gets a row in the table.
