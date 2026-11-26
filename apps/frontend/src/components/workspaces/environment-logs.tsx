import { useEffect, useRef, useState } from 'react'

import type { ContainerLogLine } from '../../lib/environment-api.ts'
import { environmentLogsPath } from '../../lib/environment-api.ts'
import { Button } from '../ui/button.tsx'

/** The most lines the panel keeps: a chatty container must not grow the page without bound. */
const MAX_LINES = 1000

/** How close to the bottom the box has to be before a new line keeps it scrolled down. */
const FOLLOW_THRESHOLD = 24

type Phase = 'connecting' | 'live' | 'ended' | 'failed'

interface Row extends ContainerLogLine {
  readonly key: number
}

const isLogLine = (value: unknown): value is ContainerLogLine => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>

  return (
    (candidate['stream'] === 'stdout' || candidate['stream'] === 'stderr') &&
    (candidate['at'] === null || typeof candidate['at'] === 'string') &&
    typeof candidate['text'] === 'string'
  )
}

/** Docker's RFC 3339 time as a local wall-clock time; the date is noise in a live log. */
const clock = (at: string | null): string => {
  if (at === null) return ''
  const date = new Date(at)

  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour12: false })
}

const PHASE_TEXT: Record<Phase, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  ended: 'The container stopped; the log ended.',
  failed: 'The log could not be read.',
}

/**
 * The container's own output, live: the last lines Docker kept, then everything it writes. This is where a container
 * that will not boot says why, so it is shown for any container that exists, running or not.
 */
export function EnvironmentLogs({ environmentId }: { environmentId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [phase, setPhase] = useState<Phase>('connecting')
  const [paused, setPaused] = useState(false)
  // Bumped to open the stream again after it ended.
  const [session, setSession] = useState(0)
  const box = useRef<HTMLPreElement>(null)
  const following = useRef(true)
  const nextKey = useRef(0)

  useEffect(() => {
    if (paused || typeof EventSource !== 'function') return

    const source = new EventSource(environmentLogsPath(environmentId))

    source.addEventListener('line', (event) => {
      let parsed: unknown
      try {
        parsed = JSON.parse((event as MessageEvent<string>).data)
      } catch {
        // A frame that is not JSON is not a line; skipping it keeps the rest of the log readable.
        return
      }
      if (!isLogLine(parsed)) return
      const row: Row = { ...parsed, key: nextKey.current++ }
      setPhase('live')
      setRows((current) => [...current, row].slice(-MAX_LINES))
    })
    source.addEventListener('open', () => setPhase('live'))
    source.addEventListener('end', () => {
      // EventSource would reconnect on its own; a stopped container's log has nothing more to say.
      source.close()
      setPhase('ended')
    })
    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) setPhase('failed')
    })

    return () => source.close()
  }, [environmentId, session, paused])

  useEffect(() => {
    const element = box.current
    if (element !== null && following.current) element.scrollTop = element.scrollHeight
  }, [rows])

  const stopped = phase === 'ended' || phase === 'failed'

  return (
    <section aria-label="Container log" className="flex flex-col gap-2 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Log</h2>
        <output className="text-xs text-muted-foreground">{paused ? 'Paused' : PHASE_TEXT[phase]}</output>
        <div className="ml-auto flex gap-2">
          {paused || stopped ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                following.current = true
                // A fresh follow starts with Docker's tail again, so the rows shown so far would repeat.
                setRows([])
                setPhase('connecting')
                if (paused) setPaused(false)
                else setSession((value) => value + 1)
              }}
            >
              {paused ? 'Resume' : 'Follow again'}
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => setPaused(true)}>
              Pause
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setRows([])}>
            Clear
          </Button>
        </div>
      </div>
      <pre
        ref={box}
        aria-label="Container output"
        onScroll={(event) => {
          const element = event.currentTarget
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD
        }}
        className="h-72 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted p-2 font-mono text-xs"
      >
        {rows.length === 0 ? (
          <span className="text-muted-foreground">No output yet.</span>
        ) : (
          rows.map((row) => (
            <div key={row.key} className={row.stream === 'stderr' ? 'text-destructive' : undefined}>
              <span className="select-none text-muted-foreground">{clock(row.at)} </span>
              {row.text}
            </div>
          ))
        )}
      </pre>
    </section>
  )
}
