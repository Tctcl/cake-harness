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

/**
 * The run's tool traffic under the reply. Each call is a collapsed line saying what ran and how long it took; the
 * arguments and the result open underneath, because a tool's payload is what makes a transcript hard to read.
 */
export function ToolTrace({ calls }: { calls: readonly ChatToolCall[] }) {
  if (calls.length === 0) return null

  return (
    <Trace aria-label="Tool calls">
      {calls.map((call) => {
        const running = call.status === 'running'

        return (
          <TraceCollapsible key={call.id}>
            <TraceCollapsibleTrigger>
              <TraceLine
                status={running ? 'running' : call.status === 'error' ? 'error' : undefined}
              >
                <TraceIcon>
                  {call.status === 'error' ? <AlertTriangleIcon /> : <WrenchIcon />}
                </TraceIcon>
                <TraceTitle>{call.name}</TraceTitle>
                {call.arguments === null ? null : (
                  <TraceDescription>{oneLine(call.arguments, 60)}</TraceDescription>
                )}
                {call.durationMs === null ? null : (
                  <span className="shrink-0 text-xs tabular-nums">
                    {Math.round(call.durationMs)} ms
                  </span>
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
                    {call.result ?? (running ? 'Running…' : 'No output')}
                  </pre>
                </div>
              </div>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        )
      })}
    </Trace>
  )
}
