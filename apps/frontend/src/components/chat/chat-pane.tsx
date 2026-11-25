import { ArrowDownIcon } from 'lucide-react'
import { useCallback, useEffect, useSyncExternalStore, useState } from 'react'

import type { ChatMessage } from '../../lib/chat-api.ts'
import type { ThreadSnapshot } from '../../lib/chat-store.ts'
import {
  KEY_PROBLEMS,
  loadOlder,
  openThread,
  retry,
  send,
  snapshotOf,
  subscribeToThread,
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
import { ToolTrace } from './tool-trace.tsx'

/** How close to the top the viewport has to be before older lines are asked for. */
const LOAD_OLDER_THRESHOLD = 160

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
  const subscribe = useCallback(
    (listener: () => void) => (threadId === null ? () => {} : subscribeToThread(threadId, listener)),
    [threadId],
  )
  const read = useCallback(() => snapshotOf(threadId), [threadId])
  const state = useSyncExternalStore(subscribe, read)

  useEffect(() => {
    if (threadId !== null) openThread(threadId)
  }, [threadId])

  if (threadId === null) return <NoConversation />

  // A live frame is proof of a run in flight even before its first entry commits, so the view keeps saying so.
  const liveWorking =
    state.live.blocks.length > 0 ||
    state.live.tools.some((tool) => tool.status !== 'done') ||
    state.live.compacting > 0
  const streaming = lastIsUnanswered(state) || liveWorking

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 py-4">
      <MessageScrollerProvider>
        <MessageScroller>
          {/* Keyed: a new conversation starts at its newest line rather than inheriting where the last one was read. */}
          <Transcript key={threadId} threadId={threadId} state={state} streaming={streaming} />
        </MessageScroller>
      </MessageScrollerProvider>

      {state.error === null ? null : (
        <p role="alert" className="mx-auto w-full max-w-3xl px-4 text-sm text-destructive">
          {state.error}
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
        <PromptInput label="Message" onSend={(text) => send(threadId, text)} />
      </div>
    </div>
  )
}

/** How close to the bottom the viewport has to be before the newest line counts as in view. */
const NEAR_BOTTOM_THRESHOLD = 64

/**
 * The transcript, and whether it is following the newest line. Following is the default; scrolling up stops it, because a
 * reader who went looking for something older is not asking to be dragged back down. The button is the way back to
 * following: it scrolls to the end, and from there the next line is followed again.
 */
function Transcript({
  threadId,
  state,
  streaming,
}: {
  threadId: string
  state: ThreadSnapshot
  streaming: boolean
}) {
  const { scrollToEnd } = useMessageScroller()
  const [pinned, setPinned] = useState(true)
  // Anything that makes the transcript taller, so growth is followed without measuring it.
  const size = transcriptSize(state)

  useEffect(() => {
    if (pinned) scrollToEnd({ behavior: 'auto' })
  }, [pinned, size, scrollToEnd])

  return (
    <>
      <MessageScrollerViewport
        preserveScrollOnPrepend
        aria-label="Transcript"
        className="px-4"
        onScroll={(event) => {
          const viewport = event.currentTarget
          const fromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
          setPinned(fromBottom < NEAR_BOTTOM_THRESHOLD)
          if (viewport.scrollTop < LOAD_OLDER_THRESHOLD) loadOlder(threadId)
        }}
      >
        <MessageScrollerContent className="mx-auto w-full max-w-3xl pb-2">
          {state.messages.map((message) => (
            <MessageScrollerItem key={message.id} messageId={String(message.id)}>
              <Line message={message} />
            </MessageScrollerItem>
          ))}

          {state.pending.map((item) => (
            <MessageScrollerItem key={item.localId} messageId={String(item.localId)}>
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
          ))}

          {state.tools.length === 0 ? null : (
            <MessageScrollerItem messageId="tools">
              <ToolTrace calls={state.tools} />
            </MessageScrollerItem>
          )}

          <MessageScrollerItem messageId="live">
            <LiveRun live={state.live} streaming={streaming} />
          </MessageScrollerItem>
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

/** A turn of the transcript: the person's line sits in a bubble, the agent's reply is rendered markdown. */
function Line({ message }: { message: ChatMessage }) {
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

  return (
    <Message>
      <MessageContent>
        <Markdown text={message.text} />
      </MessageContent>
    </Message>
  )
}

/** True while the newest line is a question with no answer yet: a submitted input, or a user entry the run has not
 * answered. */
function lastIsUnanswered(state: ThreadSnapshot): boolean {
  if (state.pending.length > 0) return true

  const last = state.messages.at(-1)
  if (last === undefined || last.role !== 'user') return false

  return state.status !== 'error'
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
