import { useEffect, useState } from 'react'

import type { DevEnvironment, EnvironmentStats } from '../../lib/environment-api.ts'
import { getEnvironmentStats, startEnvironment, stopEnvironment } from '../../lib/environment-api.ts'
import { Button } from '../ui/button.tsx'

const POLL_MS = 5_000

const bytes = (value: number) => {
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }

  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * The container the open conversation runs in: whether it is up, what it is using, and the two controls that change
 * that. Usage is polled while it runs — a stopped container has no numbers to poll for, and the poll is what makes the
 * line a live reading rather than the sample the panel happened to mount with.
 */
export function EnvironmentCard({
  environment,
  onChanged,
}: {
  environment: DevEnvironment
  onChanged: (next: DevEnvironment) => void
}) {
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<EnvironmentStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = environment.containerId !== null

  useEffect(() => {
    // A stopped container has nothing to sample; the reading below is hidden while `running` is false, so the effect
    // simply has nothing to do rather than clearing state another render would have to follow.
    if (!running) return

    let cancelled = false
    const read = () => {
      void getEnvironmentStats(environment.id).then(
        (loaded) => {
          if (!cancelled) setStats(loaded)
        },
        // A container that stopped behind the panel's back answers nothing; the line goes blank instead of erroring.
        () => {
          if (!cancelled) setStats(null)
        },
      )
    }

    read()
    const timer = window.setInterval(read, POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [environment.id, running])

  async function toggle() {
    setBusy(true)
    setError(null)

    try {
      onChanged(running ? await stopEnvironment(environment.id) : await startEnvironment(environment.id))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the container did not change state')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm">{environment.image}</span>
          <span className="text-xs text-muted-foreground">{running ? 'Running' : 'Stopped'}</span>
        </div>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void toggle()}>
          {running ? 'Stop' : 'Start'}
        </Button>
      </div>

      {!running || stats === null ? null : (
        <dl className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">CPU</dt>
            <dd>{stats.cpuPercent.toFixed(1)}%</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Memory</dt>
            <dd>
              {bytes(stats.memoryUsed)} / {bytes(stats.memoryLimit)}
            </dd>
          </div>
        </dl>
      )}

      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
