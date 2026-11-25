import { useEffect, useState } from 'react'

import type { ProviderUsage } from '../../lib/provider-api.ts'
import { listProviderUsage } from '../../lib/provider-api.ts'

const tokens = (value: number) => value.toLocaleString('en-US')

const money = (value: number) => `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`

/**
 * What the workspace's providers have been used for. A provider the workspace has not linked has no row, so this is
 * always the set of providers the open conversations can reach — not a catalog.
 */
export function ProviderUsagePanel({ workspaceId }: { workspaceId: string }) {
  const [usage, setUsage] = useState<readonly ProviderUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void listProviderUsage(workspaceId).then(
      (loaded) => {
        if (cancelled) return
        setUsage(loaded)
        setLoading(false)
      },
      (failure: unknown) => {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : 'provider usage failed to load')
        setLoading(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  if (loading) return <p className="px-1 text-xs text-muted-foreground">Loading usage…</p>
  if (error !== null) {
    return (
      <p role="alert" className="px-1 text-xs text-destructive">
        {error}
      </p>
    )
  }
  if (usage.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">This workspace reaches no provider yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {usage.map((entry) => (
        <div key={entry.provider} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium">{entry.provider}</span>
            <span className="text-sm">{money(entry.costUsd)}</span>
          </div>
          {entry.loginCount > 1 ? (
            <span className="text-xs text-muted-foreground">{entry.loginCount} logins</span>
          ) : null}
          <dl className="flex flex-col gap-0.5 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Requests</dt>
              <dd>{tokens(entry.requests)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Tokens in / out</dt>
              <dd>
                {tokens(entry.inputTokens)} / {tokens(entry.outputTokens)}
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  )
}
