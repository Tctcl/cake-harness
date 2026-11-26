import { ArrowDownIcon } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'

import type { ChatAgent, ChatLive, ChatMessage, ChatThread, ChatToolCall } from '../../lib/chat-api.ts'
import { getWorkspace, listAgents, readThread } from '../../lib/chat-api.ts'
import { getWorkspaceProviders, listProviderLogins, listProviderModels } from '../../lib/provider-api.ts'
import { listWorkspaceSubagents } from '../../lib/subagent-api.ts'
import { useThreadSnapshot } from '../../lib/use-thread-snapshot.ts'
import { choicesOf } from '../../lib/workspace-choices.ts'
import type { Choices } from '../../lib/workspace-choices.ts'
import type { PendingInput, ThreadSnapshot } from '../../lib/chat-store.ts'
import {
  KEY_PROBLEMS,
  loadOlder,
  openThread,
  retry,
  send,
} from '../../lib/chat-store.ts'
import { Bubble, BubbleContent } from '../ui/bubble.tsx'
import { Button } from '../ui/button.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty.tsx'
import { Message, MessageContent } from '../ui/message.tsx'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '../ui/message-scroller.tsx'
import { Spinner } from '../ui/spinner.tsx'
import { Markdown } from './markdown.tsx'
import { PromptInput } from './prompt-input.tsx'
import { LiveRun } from './live-run.tsx'
import { RunControls } from './run-controls.tsx'
import { ThinkingBlock } from './thinking-block.tsx'
import { ToolCallRow, ToolTrace } from './tool-trace.tsx'

interface RunControlState {
  readonly thread: ChatThread
  readonly agent: ChatAgent
  readonly choices: Choices
  readonly subagentNames: ReadonlyMap<string, string>
}

/** How close to the top the viewport has to be before older lines are asked for. */
const LOAD_OLDER_THRESHOLD = 160
const EMPTY_SUBAGENT_NAMES: ReadonlyMap<string, string> = new Map()

/**
 * One conversation. The transcript comes from the thread store rather than from this component, so a run keeps going
 * when another conversation is opened and this pane is rebuilt.
 */

export function ChatPane({
  threadId,
  onSetUpKeys,
}: {
  threadId: string | null
  /** Where the fix for a missing key or model lives: the workspace manager. */
  onSetUpKeys?: (() => void) | undefined
}) {
  const state = useThreadSnapshot(threadId)
  const [runControls, setRunControls] = useState<RunControlState | null>(null)
  const [runSettingsFailure, setRunSettingsFailure] = useState<{
    readonly threadId: string
    readonly message: string
  } | null>(null)

  useEffect(() => {
    if (threadId !== null) openThread(threadId)
  }, [threadId])

  useEffect(() => {
    if (threadId === null) return

    let cancelled = false
    const load = async (): Promise<void> => {
      const thread = await readThread(threadId)
      const [workspace, agents, logins, models, providers, subagents, archivedSubagents] = await Promise.all([
        getWorkspace(thread.workspaceId),
        listAgents(thread.workspaceId),
        listProviderLogins(),
        listProviderModels(),
        getWorkspaceProviders(thread.workspaceId),
        listWorkspaceSubagents(thread.workspaceId),
        listWorkspaceSubagents(thread.workspaceId, true),
      ])
      const agent = agents.find((candidate) => candidate.id === thread.agentId)
      if (agent === undefined) throw new Error('the conversation’s agent could not be loaded')
      if (cancelled) return

      setRunControls({
        thread,
        agent,
        choices: choicesOf(workspace, logins, models, providers),
        subagentNames: new Map([...subagents, ...archivedSubagents].map((subagent) => [subagent.id, subagent.name])),
      })
    }
    void load().catch((failure: unknown) => {
      if (!cancelled) {
        setRunSettingsFailure({
          threadId,
          message: failure instanceof Error ? failure.message : 'the run settings failed to load',
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [threadId])

  if (threadId === null) return <NoConversation />

  // A live frame is proof of a run in flight even before its first entry commits, so the view keeps saying so.
  const streaming = runIsActive(state.live)
  const visibleRunControls = runControls?.thread.id === threadId ? runControls : null
  const runSettingsError = runSettingsFailure?.threadId === threadId ? runSettingsFailure.message : null
  const chatError = runSettingsError ?? state.error
  const reportRunSettingsError = (message: string | null): void =>
    setRunSettingsFailure(message === null ? null : { threadId, message })

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 py-4">
      <MessageScrollerProvider>
        <MessageScroller>
          {/* Keyed: a new conversation starts at its newest line rather than inheriting where the last one was read. */}
          <Transcript
            key={threadId}
            threadId={threadId}
            state={state}
            streaming={streaming}
            subagentNames={visibleRunControls?.subagentNames ?? EMPTY_SUBAGENT_NAMES}
          />
        </MessageScroller>
      </MessageScrollerProvider>

      {chatError === null ? null : (
        <p role="alert" className="mx-auto w-full max-w-3xl px-4 text-sm text-destructive">
          {chatError}
          {onSetUpKeys !== undefined && state.errorCode !== null && KEY_PROBLEMS.has(state.errorCode) ? (
            <>
              {' '}
              <button type="button" className="font-medium underline" onClick={onSetUpKeys}>
                Set up a key
              </button>
            </>
          ) : null}
        </p>
      )}

      <div className="px-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          <PromptInput label="Message" onSend={(text) => send(threadId, text)} />
          {/* The row is reserved before the controls load: appearing later would shrink the transcript under the
              reader and leave it scrolled off its newest line, which stops it following the conversation. */}
          {visibleRunControls === null ? (
            <div className="h-7" aria-hidden />
          ) : (
            <RunControls
              key={threadId}
              thread={visibleRunControls.thread}
              agent={visibleRunControls.agent}
              choices={visibleRunControls.choices}
              onError={reportRunSettingsError}
              onChange={(updated) =>
                setRunControls((current) =>
                  current?.thread.id === updated.id ? { ...current, thread: updated } : current,
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** How close to the bottom the viewport has to be before the newest line counts as in view. */
const NEAR_BOTTOM_THRESHOLD = 64

/** How long after a wheel, touch, pointer or key event a scroll still counts as the reader's own. */
const GESTURE_WINDOW_MS = 1000

/**
 * The transcript, and whether it is following the newest line. Following is the default; scrolling up stops it, because a
 * reader who went looking for something older is not asking to be dragged back down. The button is the way back to
 * following: it scrolls to the end, and from there the next line is followed again.
 */
function Transcript({
  threadId,
  state,
  streaming,
  subagentNames,
}: {
  threadId: string
  state: ThreadSnapshot
  streaming: boolean
  subagentNames: ReadonlyMap<string, string>
}) {
  const { scrollToEnd } = useMessageScroller()
  const [pinned, setPinned] = useState(true)
  // Anything that makes the transcript taller, so growth is followed without measuring it.
  const size = transcriptSize(state)
  const toolsById = new Map(state.tools.map((call) => [call.id, call]))
  const positionedCallIds = new Set(
    state.messages.flatMap((message) =>
      message.blocks.flatMap((block) => (block.type === 'toolCall' ? [block.callId] : [])),
    ),
  )
  const trailingTools = state.tools.filter((call) => !positionedCallIds.has(call.id))
  const firstContextId = state.messages.find((message) => message.role === 'context')?.id

  // Read by the resize observer, which is attached once and would otherwise see the value of its first render.
  const following = useRef(pinned)
  // When the reader last scrolled on purpose. Only that may stop following: off-screen lines are laid out at an
  // estimated height until they render (`content-visibility`), and the browser's correction afterwards also arrives
  // as a scroll event, which would otherwise read as the reader leaving the newest line.
  const gestureAt = useRef(0)
  const markGesture = (): void => {
    gestureAt.current = Date.now()
  }
  const content = useRef<HTMLDivElement>(null)

  useEffect(() => {
    following.current = pinned
    if (pinned) scrollToEnd({ behavior: 'auto' })
  }, [pinned, size, scrollToEnd])

  // Lines also grow after they arrive (code highlighting, tables, a thinking block opening), which `size` cannot see.
  useEffect(() => {
    const element = content.current
    if (element === null || typeof ResizeObserver !== 'function') return

    const observer = new ResizeObserver(() => {
      if (following.current) scrollToEnd({ behavior: 'auto' })
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [scrollToEnd])

  return (
    <>
      <MessageScrollerViewport
        preserveScrollOnPrepend
        aria-label="Transcript"
        className="px-4"
        onWheel={markGesture}
        onTouchMove={markGesture}
        onPointerDown={markGesture}
        onKeyDown={markGesture}
        onScroll={(event) => {
          const viewport = event.currentTarget
          const fromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
          if (fromBottom < NEAR_BOTTOM_THRESHOLD) setPinned(true)
          else if (Date.now() - gestureAt.current < GESTURE_WINDOW_MS) setPinned(false)
          if (viewport.scrollTop < LOAD_OLDER_THRESHOLD) loadOlder(threadId)
        }}
      >
        <MessageScrollerContent className="mx-auto w-full max-w-3xl pb-2">
          <div ref={content} className="flex flex-col gap-6">
          {/* A pending line sits after the entry that was newest when it was sent, and before every line if there was
              none: a failure belongs where the person typed it, not under whatever arrived since. */}
          {leadingPending(state.pending).map((item) => (
            <PendingLine key={item.localId} item={item} threadId={threadId} />
          ))}

          {inReceivedOrder(state.messages).map((message) => (
            <Fragment key={message.id}>
              <MessageScrollerItem messageId={String(message.id)}>
                <Line
                  message={message}
                  tools={toolsById}
                  streaming={streaming}
                  firstContext={message.id === firstContextId}
                  threadId={threadId}
                  subagentNames={subagentNames}
                />
              </MessageScrollerItem>

              {state.pending
                .filter((item) => item.afterId === message.id)
                .map((item) => (
                  <PendingLine key={item.localId} item={item} threadId={threadId} />
                ))}
            </Fragment>
          ))}

          {/* A line whose anchor is not loaded (a long thread keeps only its newest window) still has to show somewhere. */}
          {unanchoredPending(state).map((item) => (
            <PendingLine key={item.localId} item={item} threadId={threadId} />
          ))}

          {trailingTools.length === 0 ? null : (
            <MessageScrollerItem messageId="tools">
              <ToolTrace
                calls={trailingTools}
                active={streaming}
                threadId={threadId}
                subagentNames={subagentNames}
              />
            </MessageScrollerItem>
          )}

          <MessageScrollerItem messageId="live">
            <LiveRun
              live={state.live}
              streaming={streaming}
              threadId={threadId}
              failureShown={newestLineFailed(state.messages)}
            />
          </MessageScrollerItem>
          </div>
        </MessageScrollerContent>
      </MessageScrollerViewport>

      {pinned ? null : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 gap-2"
          onClick={() => {
            scrollToEnd({ behavior: 'smooth' })
            setPinned(true)
          }}
        >
          <ArrowDownIcon className="size-4" aria-hidden />
          Jump to newest
        </Button>
      )}
    </>
  )
}

/** Everything that makes the transcript taller, in one comparable value: new lines, and the live turn growing. */
function transcriptSize(state: ThreadSnapshot): string {
  const live = state.live.blocks
    .map((block) => (block.type === 'toolCall' ? `t${block.callId}` : `${block.type[0]}${block.text.length}`))
    .join('.')

  return `${state.messages.length}|${state.pending.length}|${state.tools.length}|${state.live.compacting}|${live}`
}

/** A transcript line: user input, an ordered assistant turn, or a visible context boundary. */
function Line({
  message,
  tools,
  streaming,
  firstContext,
  threadId,
  subagentNames,
}: {
  message: ChatMessage
  tools: ReadonlyMap<string, ChatToolCall>
  streaming: boolean
  firstContext: boolean
  threadId: string
  subagentNames: ReadonlyMap<string, string>
}) {
  if (message.role === 'user') {
    return (
      <Message align="end">
        <MessageContent>
          <Bubble align="end">
            <BubbleContent>{message.text}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }

  if (message.role === 'compaction') {
    return (
      <details className="rounded-sm border border-border/60 px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Context compacted{message.reason === null ? '' : ` (${message.reason})`}
        </summary>
        <div className="mt-3">
          <Markdown text={message.text} />
        </div>
      </details>
    )
  }

  if (message.role === 'context') {
    const sections = message.sections ?? []
    const added = message.toolsAdded ?? []
    const removed = message.toolsRemoved ?? []

    return (
      <div className="flex flex-col gap-1 rounded-sm border border-border/60 px-3 py-2 text-xs">
        <span className="font-medium text-muted-foreground">
          {firstContext ? 'Context sent' : 'Context updated'}
        </span>
        {sections.map(({ key, text }) => (
          <details key={key} className="min-w-0">
            <summary className="cursor-pointer text-muted-foreground">
              {key === 'cake-system' ? 'System prompt' : key === 'instructions' ? 'Agent instructions' : key}
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-sm bg-muted p-2 font-mono">
              {text ?? 'Removed'}
            </pre>
          </details>
        ))}
        {added.length > 0 || removed.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              {added.length > 0 ? `Tools offered: ${added.join(', ')}` : `Tools removed: ${removed.join(', ')}`}
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-sm bg-muted p-2 font-mono">
              {[
                ...(added.length > 0 ? [`Added: ${added.join(', ')}`] : []),
                ...(removed.length > 0 ? [`Removed: ${removed.join(', ')}`] : []),
              ].join('\n')}
            </pre>
          </details>
        ) : null}
      </div>
    )
  }

  if (message.role === 'reset') {
    if (message.text === '') {
      return (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <hr className="flex-1 border-border" />
          <span>Context reset</span>
          <hr className="flex-1 border-border" />
        </div>
      )
    }

    return (
      <details className="border-y border-border/60 px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Context reset</summary>
        <div className="mt-3">
          <Markdown text={message.text} />
        </div>
      </details>
    )
  }

  return (
    <Message>
      <MessageContent>
        {message.stopReason === 'error' || message.errorMessage !== null ? (
          <div role="alert" className="rounded-sm border border-destructive/40 px-3 py-2 text-sm text-destructive">
            {message.errorMessage ?? 'The assistant response ended with an error.'}
          </div>
        ) : null}

        {message.blocks.map((block, index) => {
          if (block.type === 'text') return <Markdown key={`text-${String(index)}`} text={block.text} />
          if (block.type === 'thinking') {
            return (
              <ThinkingBlock
                key={`thinking-${String(index)}`}
                text={block.text}
                redacted={block.redacted}
              />
            )
          }

          const settled = tools.get(block.callId)
          const call: ChatToolCall =
            settled === undefined
              ? {
                  id: block.callId,
                  entryId: message.id,
                  name: block.name,
                  arguments: block.arguments,
                  status: 'running',
                  result: null,
                  durationMs: null,
                  truncated: false,
                  fullByteLength: 0,
                }
              : { ...settled, arguments: block.arguments }

          return (
            <ToolCallRow
              key={block.callId}
              call={call}
              active={streaming}
              threadId={threadId}
              subagentNames={subagentNames}
            />
          )
        })}
      </MessageContent>
    </Message>
  )
}

/** Whether the newest line is an answer that ended in an error, which already shows the run's failure on the line. */
function newestLineFailed(messages: readonly ChatMessage[]): boolean {
  const newest = messages.at(-1)

  return newest?.role === 'assistant' && (newest.stopReason === 'error' || newest.errorMessage !== null)
}

/**
 * The transcript in the order the model receives it. Durable writes a request's system entry (the system prompt, the
 * agent's part, the offered tools) in the same commit as the request, so after the person's line that triggered it;
 * the model reads that context first. A context line right after a person's line is shown before it.
 */
function inReceivedOrder(messages: readonly ChatMessage[]): ChatMessage[] {
  const ordered: ChatMessage[] = []
  for (const message of messages) {
    const previous = ordered.at(-1)
    if (message.role === 'context' && previous?.role === 'user') ordered.splice(ordered.length - 1, 0, message)
    else ordered.push(message)
  }

  return ordered
}

/** The optimistic lines sent before anything was stored: they precede every message. */
function leadingPending(pending: readonly PendingInput[]): readonly PendingInput[] {
  return pending.filter((item) => item.afterId === null)
}

/** Optimistic lines anchored to an entry that is not among the loaded messages: they go after everything. */
function unanchoredPending(state: ThreadSnapshot): readonly PendingInput[] {
  const loaded = new Set(state.messages.map((message) => message.id))

  return state.pending.filter((item) => item.afterId !== null && !loaded.has(item.afterId))
}

/** One line still on its way, or one that failed and offers the retry. Retry reuses this row, so it does not move. */
function PendingLine({ threadId, item }: { threadId: string; item: PendingInput }) {
  return (
    <MessageScrollerItem messageId={String(item.localId)}>
      <Message align="end">
        <MessageContent>
          <Bubble align="end">
            <BubbleContent>{item.text}</BubbleContent>
          </Bubble>
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            {item.state === 'sending' ? (
              <>
                <Spinner className="size-3" />
                <span>Sending</span>
              </>
            ) : (
              <>
                <span role="alert">Not sent</span>
                <Button variant="ghost" size="sm" onClick={() => retry(threadId, item.localId)}>
                  Retry
                </Button>
              </>
            )}
          </div>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  )
}

/**
 * Whether the live state says a run is in flight: a partial answer, a tool round, a compaction, or a run that exists.
 * An optimistic line is not a run — one still sending only says so itself, and one that failed never becomes a run.
 */
function runIsActive(live: ChatLive): boolean {
  return (
    live.blocks.length > 0 ||
    live.tools.some((tool) => tool.status !== 'done') ||
    live.turns > 0 ||
    live.compacting > 0
  )
}

function NoConversation() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>No conversation open</EmptyTitle>
        <EmptyDescription>
          Open one from the conversation list, or start a new one with the + next to a workspace. Agents answer with an
          OpenCode Go key: add one in Settings → Credentials if you have not yet.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
