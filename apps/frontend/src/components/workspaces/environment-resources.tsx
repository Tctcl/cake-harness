import { useEffect, useState } from 'react'

import type { ContainerMetrics } from '../../lib/environment-api.ts'
import { getEnvironmentMetrics } from '../../lib/environment-api.ts'

const POLL_MS = 2_000
const HISTORY_SIZE = 60

interface MetricSample extends ContainerMetrics {
  readonly sampledAt: number
}

interface TransferRates {
  readonly networkReceive: number
  readonly networkTransmit: number
  readonly blockRead: number
  readonly blockWrite: number
}

const failureMessage = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'container metrics could not be read'

const formatBytes = (value: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.max(value, 0)
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }

  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

const rate = (current: number, previous: number, elapsedSeconds: number): number =>
  Math.max(current - previous, 0) / elapsedSeconds

const ratesOf = (current: MetricSample, previous: MetricSample): TransferRates | null => {
  const elapsedSeconds = (current.sampledAt - previous.sampledAt) / 1_000
  if (elapsedSeconds <= 0) return null

  return {
    networkReceive: rate(current.networkReceiveBytes, previous.networkReceiveBytes, elapsedSeconds),
    networkTransmit: rate(current.networkTransmitBytes, previous.networkTransmitBytes, elapsedSeconds),
    blockRead: rate(current.blockReadBytes, previous.blockReadBytes, elapsedSeconds),
    blockWrite: rate(current.blockWriteBytes, previous.blockWriteBytes, elapsedSeconds),
  }
}

function Sparkline({ label, values }: { label: string; values: readonly number[] }) {
  const maximum = Math.max(...values, 1)
  const denominator = Math.max(values.length - 1, 1)
  const points = values
    .map((value, index) => `${(index / denominator) * 120},${26 - (Math.max(value, 0) / maximum) * 24}`)
    .join(' ')

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 120 28"
      className="h-7 w-full text-muted-foreground"
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function UsageBar({ label, percent }: { label: string; percent: number }) {
  const bounded = Math.min(Math.max(percent, 0), 100)

  return <progress aria-label={label} className="h-1.5 w-full" max={100} value={bounded} />
}

/**
 * Live Docker counters become rates only between consecutive samples. The interval and its in-flight bookkeeping live
 * here so hiding the document, leaving the tab, or stopping the container stops requests rather than merely the paint.
 */
export function EnvironmentResources({ environmentId }: { environmentId: string }) {
  const [samples, setSamples] = useState<readonly MetricSample[]>([])
  const [rates, setRates] = useState<TransferRates | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let polling = false
    let reading = false
    let timer: number | undefined
    let previous: MetricSample | undefined

    const read = async () => {
      // Slow Docker stats must not overlap and turn the consecutive-counter deltas into out-of-order rates.
      if (reading) return
      reading = true
      try {
        const metrics = await getEnvironmentMetrics(environmentId)
        if (!active || !polling) return
        const sample = { ...metrics, sampledAt: Date.now() }
        setSamples((current) => [...current, sample].slice(-HISTORY_SIZE))
        if (previous !== undefined) setRates(ratesOf(sample, previous))
        previous = sample
        setError(null)
      } catch (failure) {
        if (active && polling) setError(failureMessage(failure))
      } finally {
        reading = false
      }
    }

    const stop = () => {
      polling = false
      if (timer !== undefined) window.clearInterval(timer)
      timer = undefined
      // A resumed series gets a fresh baseline rather than presenting a multi-minute gap as a two-second rate.
      previous = undefined
    }
    const start = () => {
      if (timer !== undefined || document.hidden) return
      polling = true
      void read()
      timer = window.setInterval(() => void read(), POLL_MS)
    }
    const visibilityChanged = () => {
      if (document.hidden) stop()
      else start()
    }

    start()
    document.addEventListener('visibilitychange', visibilityChanged)

    return () => {
      active = false
      stop()
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [environmentId])

  const latest = samples.at(-1)
  const cpuHistory = samples.map((sample) => sample.cpuPercent)
  const memoryHistory = samples.map((sample) => sample.memoryUsedBytes)
  const memoryPercent = latest === undefined || latest.memoryLimitBytes === 0
    ? 0
    : (latest.memoryUsedBytes / latest.memoryLimitBytes) * 100

  return (
    <section aria-label="Live resources" className="flex flex-col gap-3 rounded-md border p-4">
      <div>
        <h2 className="font-medium">Live resources</h2>
        <p className="text-xs text-muted-foreground">Sampled every two seconds while this tab is visible.</p>
      </div>

      {latest === undefined ? (
        <p className="text-muted-foreground">Waiting for the first sample…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span>CPU</span>
                <span className="font-mono text-xs">{latest.cpuPercent.toFixed(1)}%</span>
              </div>
              <UsageBar label="CPU usage" percent={latest.cpuPercent} />
              <Sparkline label="CPU history" values={cpuHistory} />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span>Memory</span>
                <span className="font-mono text-xs">
                  {formatBytes(latest.memoryUsedBytes)} / {formatBytes(latest.memoryLimitBytes)}
                </span>
              </div>
              <UsageBar label="Memory usage" percent={memoryPercent} />
              <Sparkline label="Memory history" values={memoryHistory} />
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Network RX</dt>
              <dd className="font-mono">{rates === null ? '—' : `${formatBytes(rates.networkReceive)}/s`}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Network TX</dt>
              <dd className="font-mono">{rates === null ? '—' : `${formatBytes(rates.networkTransmit)}/s`}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Disk read</dt>
              <dd className="font-mono">{rates === null ? '—' : `${formatBytes(rates.blockRead)}/s`}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Disk write</dt>
              <dd className="font-mono">{rates === null ? '—' : `${formatBytes(rates.blockWrite)}/s`}</dd>
            </div>
          </dl>
        </>
      )}

      {error === null ? null : <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  )
}
