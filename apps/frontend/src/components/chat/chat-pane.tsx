import { useCallback, useEffect, useSyncExternalStore } from 'react'

import type { ChatMessage } from '../../lib/chat-api.ts'
import type { ThreadSnapshot } from '../../lib/chat-store.ts'
import {
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
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
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
export function ChatPane({ threadId }: { threadId: string | null }) {
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
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport
            preserveScrollOnPrepend
            aria-label="Transcript"
            className="px-4"
            onScroll={(event) => {
              if (event.currentTarget.scrollTop < LOAD_OLDER_THRESHOLD) loadOlder(threadId)
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
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => retry(threadId, item.localId)}
                            >
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
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      {state.error === null ? null : (
        <p role="alert" className="mx-auto w-full max-w-3xl px-4 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="px-4">
        <PromptInput label="Message" onSend={(text) => send(threadId, text)} />
      </div>
    </div>
  )
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
        <EmptyTitle>No conversation yet</EmptyTitle>
        <EmptyDescription>
          Pick a conversation on the left, or start one in the selected workspace.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
