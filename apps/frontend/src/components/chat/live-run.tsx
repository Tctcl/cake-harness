import { AlertTriangleIcon, LoaderCircleIcon, WrenchIcon } from 'lucide-react'

import type { ChatLive, ChatLiveBlock, ChatLiveTool, ChatRunFailure } from '../../lib/chat-api.ts'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '../ui/reasoning.tsx'
import { Markdown } from './markdown.tsx'

/**
 * What the conversation is doing while it works: the reasoning as it streams, the text as it is written, and each tool
 * call with the output it has published so far. Nothing is held back for the finished answer — the point of the view is
 * that the process is visible, not only its product.
 */

/** A run of blocks the provider produced together: one reasoning stretch, one text stretch, one batch of calls. */
type Segment =
  | { readonly kind: 'thinking'; text: string; readonly redacted: boolean }
  | { readonly kind: 'text'; text: string }
  | { readonly kind: 'calls'; readonly calls: readonly ChatLiveBlock[] }

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

    if (last?.kind === 'calls') return [...segments.slice(0, -1), { kind: 'calls', calls: [...last.calls, block] }]

    return [...segments, { kind: 'calls', calls: [block] }]
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

const ToolSlot = ({ tool }: { tool: ChatLiveTool }) => {
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

const SegmentView = ({ segment, streaming }: { segment: Segment; streaming: boolean }) => {
  if (segment.kind === 'thinking') {
    return (
      <Reasoning isStreaming={streaming}>
        <ReasoningTrigger />
        <ReasoningContent>
          {segment.text === ''
            ? 'The provider did not release this reasoning: only its signature came back.'
            : segment.text}
        </ReasoningContent>
      </Reasoning>
    )
  }

  if (segment.kind === 'text') return <Markdown text={segment.text} />

  return (
    <div className="flex flex-col gap-1">
      {segment.calls.map((call) =>
        call.type === 'toolCall' ? (
          <CallLine arguments={call.arguments} key={call.callId} name={call.name} />
        ) : null,
      )}
    </div>
  )
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

export function LiveRun({ live, streaming }: { live: ChatLive; streaming: boolean }) {
  const segments = segmentsOf(live.blocks)
  const working = streaming || live.compacting > 0

  // Nothing is in flight and nothing failed: the view has nothing to say, and the transcript speaks for itself.
  const busy = live.blocks.length > 0 || live.tools.length > 0 || live.failure !== null || working

  if (!busy) return null

  return (
    <div className="not-prose flex flex-col gap-3">
      {segments.map((segment, index) => (
        <SegmentView key={`${segment.kind}-${String(index)}`} segment={segment} streaming={streaming} />
      ))}

      {live.tools.map((tool) => (
        <ToolSlot key={`${tool.id}-${tool.status}-${String(tool.output?.length ?? 0)}`} tool={tool} />
      ))}

      {live.compacting === 0 ? null : (
        <p className="text-xs">
          <span className="shimmer">Compacting the transcript…</span>
        </p>
      )}

      {working && segments.length === 0 && live.tools.length === 0 ? (
        <p className="text-sm">
          <span className="shimmer">Thinking…</span>
        </p>
      ) : null}

      {live.failure === null ? null : <FailureNotice failure={live.failure} />}
    </div>
  )
}
