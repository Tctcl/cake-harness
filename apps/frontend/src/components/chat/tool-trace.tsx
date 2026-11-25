import { AlertTriangleIcon, WrenchIcon } from 'lucide-react'

import type { ChatToolCall } from '../../lib/chat-api.ts'
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

function ToolCallItem({ call, active }: { call: ChatToolCall; active: boolean }) {
  const running = call.status === 'running' && active
  const missingResult = call.status === 'running' && !active

  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={running ? 'running' : call.status === 'error' ? 'error' : undefined}>
          <TraceIcon>{call.status === 'error' ? <AlertTriangleIcon /> : <WrenchIcon />}</TraceIcon>
          <TraceTitle>{call.name}</TraceTitle>
          {call.arguments === null ? null : (
            <TraceDescription>{oneLine(call.arguments, 60)}</TraceDescription>
          )}
          {missingResult ? <span className="shrink-0 text-xs">No result recorded</span> : null}
          {call.durationMs === null ? null : (
            <span className="shrink-0 text-xs tabular-nums">{Math.round(call.durationMs)} ms</span>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div className="flex flex-col gap-2 text-xs">
          {call.arguments === null ? null : (
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">Arguments</span>
              <pre className="overflow-x-auto rounded-sm bg-muted p-2 font-mono">{call.arguments}</pre>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="font-medium text-foreground">
              {call.status === 'error' ? 'Error' : 'Result'}
            </span>
            <pre className="overflow-x-auto rounded-sm bg-muted p-2 font-mono">
              {call.result ?? (running ? 'Running…' : missingResult ? 'No result recorded' : 'No output')}
            </pre>
          </div>
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

/** One settled or unresolved tool row, placed at the call's position in its turn. */
export function ToolCallRow({ call, active }: { call: ChatToolCall; active: boolean }) {
  return (
    <Trace aria-label={`Tool call: ${call.name}`}>
      <ToolCallItem call={call} active={active} />
    </Trace>
  )
}

/** Calls whose owning assistant entries are not loaded still render together at the end of the transcript. */
export function ToolTrace({ calls, active }: { calls: readonly ChatToolCall[]; active: boolean }) {
  if (calls.length === 0) return null

  return (
    <Trace aria-label="Tool calls">
      {calls.map((call) => (
        <ToolCallItem key={call.id} call={call} active={active} />
      ))}
    </Trace>
  )
}
