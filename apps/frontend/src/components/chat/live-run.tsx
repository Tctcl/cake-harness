import { AlertTriangleIcon, LoaderCircleIcon, WrenchIcon } from 'lucide-react'
import { useState } from 'react'

import { answerQuestion } from '../../lib/chat-api.ts'
import type { ChatLive, ChatLiveBlock, ChatLiveTool, ChatRunFailure } from '../../lib/chat-api.ts'
import { Button } from '../ui/button.tsx'
import { Markdown } from './markdown.tsx'
import { ThinkingBlock } from './thinking-block.tsx'

/**
 * What the conversation is doing while it works: the reasoning as it streams, the text as it is written, and each tool
 * call with the output it has published so far. Nothing is held back for the finished answer — the point of the view is
 * that the process is visible, not only its product.
 */

/** Consecutive text or reasoning folds together; each tool call keeps its own exact position. */
type Segment =
  | { readonly kind: 'thinking'; text: string; readonly redacted: boolean }
  | { readonly kind: 'text'; text: string }
  | { readonly kind: 'toolCall'; readonly call: Extract<ChatLiveBlock, { type: 'toolCall' }> }

/** Consecutive blocks of the same kind fold into one segment, so alternating turns stay in the order they happened. */
const segmentsOf = (blocks: readonly ChatLiveBlock[]): Segment[] =>
  blocks.reduce<Segment[]>((segments, block) => {
    const last = segments.at(-1)
    if (block.type === 'text') {
      if (last?.kind === 'text') last.text += block.text
      else segments.push({ kind: 'text', text: block.text })

      return segments
    }
    if (block.type === 'thinking') {
      if (last?.kind === 'thinking') last.text += block.text
      else segments.push({ kind: 'thinking', text: block.text, redacted: block.redacted })

      return segments
    }

    return [...segments, { kind: 'toolCall', call: block }]
  }, [])

const oneLine = (value: string, max: number) => {
  const flat = value.replaceAll(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

const CallLine = ({ name, arguments: args }: { name: string; arguments: string }) => (
  <div className="flex items-baseline gap-2 font-mono text-xs text-muted-foreground">
    <WrenchIcon className="size-3 shrink-0 self-center" aria-hidden />
    <span className="text-foreground">{name}</span>
    <span className="truncate">{oneLine(args, 100)}</span>
  </div>
)

const QuestionCard = ({
  threadId,
  callId,
  question,
}: {
  threadId: string
  callId: string
  question: NonNullable<ChatLiveTool['question']>
}) => {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const submit = async (answer: string): Promise<void> => {
    setSending(true)
    setFailure(null)
    try {
      await answerQuestion(threadId, callId, answer)
      setSubmitted(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Your answer could not be sent.')
    } finally {
      setSending(false)
    }
  }

  const disabled = sending || submitted

  return (
    <section aria-label="Question from assistant" className="flex flex-col gap-3 rounded-sm border border-border px-3 py-3">
      <p className="text-sm font-medium">{question.text}</p>
      {question.options.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          {question.options.map((option) => (
            <Button
              key={option}
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => void submit(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      )}
      {question.allowFreeText ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const answer = draft.trim()
            if (answer !== '') void submit(answer)
          }}
        >
          <input
            aria-label="Your answer"
            className="min-w-0 flex-1 rounded-sm border border-input bg-background px-3 py-2 text-sm"
            disabled={disabled}
            maxLength={4000}
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <Button type="submit" disabled={disabled || draft.trim() === ''}>
            {sending ? 'Sending…' : 'Answer'}
          </Button>
        </form>
      ) : null}
      {submitted ? <p className="text-xs text-muted-foreground">Answer sent</p> : null}
      {failure === null ? null : <p role="alert" className="text-sm text-destructive">{failure}</p>}
    </section>
  )
}

const ToolSlot = ({ tool, threadId }: { tool: ChatLiveTool; threadId: string }) => {
  if (
    tool.name === 'ask_user' &&
    tool.question !== null &&
    (tool.status === 'sleeping' || tool.status === 'waiting')
  ) {
    return <QuestionCard threadId={threadId} callId={tool.id} question={tool.question} />
  }

  const running = tool.status !== 'done'

  return (
    <details className="group rounded-sm border border-border/60 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground">
        {running ? (
          <LoaderCircleIcon className="size-3 shrink-0 animate-spin" aria-hidden />
        ) : (
          <WrenchIcon className="size-3 shrink-0" aria-hidden />
        )}
        <span className={running ? 'shimmer' : 'text-foreground'}>{tool.name}</span>
        <span className="ml-auto tabular-nums">{tool.status}</span>
      </summary>
      <pre className="mt-2 overflow-x-auto rounded-sm bg-muted p-2 font-mono whitespace-pre-wrap">
        {tool.output ?? (running ? 'Running…' : 'No output')}
      </pre>
      {tool.droppedBytes === 0 && tool.droppedLines === 0 ? null : (
        <p className="mt-1 text-muted-foreground">
          {tool.droppedLines} lines and {tool.droppedBytes} bytes beyond the view's bound were not shown.
        </p>
      )}
      {tool.diagnostics.length === 0 ? null : (
        <ul className="mt-1 flex flex-col gap-1 text-destructive">
          {tool.diagnostics.map((diagnostic) => (
            <li key={diagnostic}>{diagnostic}</li>
          ))}
        </ul>
      )}
    </details>
  )
}

const SegmentView = ({
  segment,
  streaming,
  tool,
  threadId,
  compact,
}: {
  segment: Segment
  streaming: boolean
  tool: ChatLiveTool | undefined
  threadId: string
  compact: boolean
}) => {
  if (segment.kind === 'thinking') {
    return <ThinkingBlock text={segment.text} redacted={segment.redacted} streaming={streaming && !compact} />
  }

  if (segment.kind === 'text') return <Markdown text={segment.text} />
  if (tool !== undefined) return <ToolSlot tool={tool} threadId={threadId} />

  return <CallLine arguments={segment.call.arguments} name={segment.call.name} />
}

const FailureNotice = ({ failure }: { failure: ChatRunFailure }) => (
  <div className="flex flex-col gap-1 rounded-sm border border-destructive/40 px-3 py-2 text-xs">
    <span className="flex items-center gap-2 font-medium text-destructive">
      <AlertTriangleIcon className="size-3" aria-hidden />
      {failure.reason}
    </span>
    {failure.detail === null ? null : (
      <pre className="overflow-x-auto font-mono whitespace-pre-wrap text-muted-foreground">
        {failure.detail}
      </pre>
    )}
  </div>
)

export function LiveRun({
  live,
  streaming,
  threadId,
  failureShown = false,
  compact = false,
}: {
  live: ChatLive
  streaming: boolean
  threadId: string
  /** The newest transcript line already carries this run's error, so a second notice would only repeat it. */
  failureShown?: boolean
  /** Dense child panes keep reasoning collapsed even while it streams. */
  compact?: boolean
}) {
  const failure = failureShown ? null : live.failure
  const segments = segmentsOf(live.blocks)
  const toolsById = new Map(live.tools.map((tool) => [tool.id, tool]))
  const blockCallIds = new Set(
    live.blocks.flatMap((block) => (block.type === 'toolCall' ? [block.callId] : [])),
  )
  const trailingTools = live.tools.filter((tool) => !blockCallIds.has(tool.id))
  const working = streaming || live.compacting > 0
  const waitingForAnswer = live.tools.some(
    (tool) =>
      tool.name === 'ask_user' &&
      tool.question !== null &&
      (tool.status === 'sleeping' || tool.status === 'waiting'),
  )

  // Nothing is in flight and nothing failed: the view has nothing to say, and the transcript speaks for itself.
  const busy = live.blocks.length > 0 || live.tools.length > 0 || failure !== null || working

  if (!busy) return null

  return (
    <div className={`not-prose flex flex-col ${compact ? 'gap-1.5 [&_[data-slot=collapsible]]:mb-0' : 'gap-3'}`}>
      {segments.map((segment, index) => (
        <SegmentView
          key={`${segment.kind}-${String(index)}`}
          segment={segment}
          streaming={streaming}
          tool={segment.kind === 'toolCall' ? toolsById.get(segment.call.callId) : undefined}
          threadId={threadId}
          compact={compact}
        />
      ))}

      {trailingTools.map((tool) => (
        <ToolSlot
          key={`${tool.id}-${tool.status}-${String(tool.output?.length ?? 0)}`}
          tool={tool}
          threadId={threadId}
        />
      ))}

      {waitingForAnswer ? <p className="text-sm">Waiting for your answer</p> : null}

      {live.compacting === 0 ? null : (
        <p className="text-xs">
          <span className="shimmer">Compacting the transcript…</span>
        </p>
      )}

      {working && !waitingForAnswer && segments.length === 0 && live.tools.length === 0 ? (
        <p className="text-sm">
          <span className="shimmer">Thinking…</span>
        </p>
      ) : null}

      {failure === null ? null : <FailureNotice failure={failure} />}
    </div>
  )
}
