import { AlertTriangleIcon, WrenchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ChatToolCall } from '../../lib/chat-api.ts'
import { readToolCallDetails } from '../../lib/chat-api.ts'
import type { ChatToolCallDetails } from '../../lib/chat-api.ts'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '../ui/trace.tsx'

const oneLine = (value: string, max: number) => {
  const flat = value.replaceAll(/\s+/g, ' ').trim()

  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

const EMPTY_SUBAGENT_NAMES: ReadonlyMap<string, string> = new Map()

/** Delegate arguments name an id; the conversation's profile catalog supplies its readable name. */
function presentationOf(call: ChatToolCall, subagentNames: ReadonlyMap<string, string>): {
  readonly title: string
  readonly summary: string | null
} {
  if (call.name !== 'delegate') {
    return { title: call.name, summary: call.arguments === null ? null : oneLine(call.arguments, 60) }
  }

  let subagentId: string | undefined
  let task: string | undefined
  if (call.arguments !== null) {
    try {
      const parsed: unknown = JSON.parse(call.arguments)
      if (typeof parsed === 'object' && parsed !== null) {
        const args = parsed as Record<string, unknown>
        if (typeof args.subagentId === 'string') subagentId = args.subagentId
        if (typeof args.task === 'string') task = args.task
      }
    } catch {
      // An incomplete live JSON string still gets the generic argument summary until it can be parsed.
    }
  }

  const name = subagentId === undefined ? 'sub agent' : subagentNames.get(subagentId) ?? subagentId
  return {
    title: `Delegated to ${name}`,
    summary: task === undefined ? (call.arguments === null ? null : oneLine(call.arguments, 60)) : oneLine(task, 60),
  }
}

function ToolCallItem({
  call,
  active,
  threadId,
  subagentNames,
}: {
  call: ChatToolCall
  active: boolean
  threadId: string
  subagentNames: ReadonlyMap<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [fullDetails, setFullDetails] = useState<ChatToolCallDetails | null>(null)
  const [loadingFullDetails, setLoadingFullDetails] = useState(false)
  const [fullDetailsError, setFullDetailsError] = useState<string | null>(null)
  const running = call.status === 'running' && active
  const missingResult = call.status === 'running' && !active
  const fetchFullDetails =
    call.truncated &&
    (fullDetails === null || (call.status !== 'running' && fullDetails.result === null && call.result !== null))

  useEffect(() => {
    if (!open || !fetchFullDetails || fullDetailsError !== null) return

    let cancelled = false
    void readToolCallDetails(threadId, call.id).then(
      (details) => {
        if (cancelled) return
        setFullDetails(details)
        setLoadingFullDetails(false)
      },
      (failure: unknown) => {
        if (cancelled) return
        setFullDetailsError(failure instanceof Error ? failure.message : 'The full tool output could not be loaded.')
        setLoadingFullDetails(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [call.id, fetchFullDetails, fullDetailsError, open, threadId])

  const argumentsText = fullDetails?.arguments ?? call.arguments
  const resultText = fullDetails?.result ?? call.result
  const presentation = presentationOf(call, subagentNames)

  return (
    <TraceCollapsible
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) return
        setFullDetailsError(null)
        if (fetchFullDetails) setLoadingFullDetails(true)
      }}
    >
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? 'running' : call.status === 'error' ? 'error' : undefined}>
          <TraceIcon>{call.status === 'error' ? <AlertTriangleIcon /> : <WrenchIcon />}</TraceIcon>
          <TraceTitle>{presentation.title}</TraceTitle>
          {presentation.summary === null ? null : (
            <TraceDescription>{presentation.summary}</TraceDescription>
          )}
          {missingResult ? <span className="shrink-0 text-xs">No result recorded</span> : null}
          {call.durationMs === null ? null : (
            <span className="shrink-0 text-xs tabular-nums">{Math.round(call.durationMs)} ms</span>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="flex flex-col gap-2 text-xs">
          {argumentsText === null ? null : (
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">Arguments</span>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm bg-muted p-2 font-mono">
                {argumentsText}
              </pre>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">
              {call.status === 'error' ? 'Error' : 'Result'}
            </span>
            {call.truncated && fullDetails !== null ? (
              <span className="text-muted-foreground">
                Showing the full output ({call.fullByteLength} bytes)
              </span>
            ) : null}
            {loadingFullDetails ? <span className="text-muted-foreground">Loading full output…</span> : null}
            {fullDetailsError === null ? null : <p role="alert" className="text-destructive">{fullDetailsError}</p>}
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-sm bg-muted p-2 font-mono">
              {resultText ?? (running ? 'Running…' : missingResult ? 'No result recorded' : 'No output')}
            </pre>
          </div>
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** One settled or unresolved tool row, placed at the call's position in its turn. */
export function ToolCallRow({
  call,
  active,
  threadId,
  subagentNames = EMPTY_SUBAGENT_NAMES,
}: {
  call: ChatToolCall
  active: boolean
  threadId: string
  subagentNames?: ReadonlyMap<string, string>
}) {
  return (
    <Trace aria-label={`Tool call: ${presentationOf(call, subagentNames).title}`}>
      <ToolCallItem call={call} active={active} threadId={threadId} subagentNames={subagentNames} />
    </Trace>
  )
}

/** Calls whose owning assistant entries are not loaded still render together at the end of the transcript. */
export function ToolTrace({
  calls,
  active,
  threadId,
  subagentNames = EMPTY_SUBAGENT_NAMES,
}: {
  calls: readonly ChatToolCall[]
  active: boolean
  threadId: string
  subagentNames?: ReadonlyMap<string, string>
}) {
  if (calls.length === 0) return null

  return (
    <Trace aria-label="Tool calls">
      {calls.map((call) => (
        <ToolCallItem
          key={call.id}
          call={call}
          active={active}
          threadId={threadId}
          subagentNames={subagentNames}
        />
      ))}
    </Trace>
  )
}
