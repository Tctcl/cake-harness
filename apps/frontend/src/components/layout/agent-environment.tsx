import { useEffect, useState } from 'react'

import type { DevEnvironment } from '../../lib/environment-api.ts'
import {
  connectAgentEnvironment,
  disconnectAgentEnvironment,
  getAgentEnvironment,
  listWorkspaceEnvironments,
} from '../../lib/environment-api.ts'

/**
 * The container the open conversation's agent works in. The picker only offers what the workspace is attached to, and
 * an agent holds at most one, so the empty choice is a state rather than a missing answer. A failed save restores
 * what the backend last confirmed instead of showing a choice that did not stick.
 */
export function AgentEnvironment({
  workspaceId,
  agentId,
}: {
  workspaceId: string
  agentId: string
}) {
  const [available, setAvailable] = useState<DevEnvironment[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    void Promise.all([
      listWorkspaceEnvironments(workspaceId),
      getAgentEnvironment(workspaceId, agentId),
    ]).then(
      ([options, current]) => {
        if (!active) return
        setAvailable(options)
        setSelected(current?.id ?? null)
      },
      (failure: unknown) => {
        if (!active) return
        setError(failure instanceof Error ? failure.message : 'environments failed to load')
      },
    )

    return () => {
      active = false
    }
  }, [workspaceId, agentId])

  async function choose(next: string) {
    const previous = selected
    setSelected(next === '' ? null : next)
    setSaving(true)
    setError(null)

    try {
      if (next === '') {
        await disconnectAgentEnvironment(workspaceId, agentId)
      } else {
        await connectAgentEnvironment(workspaceId, agentId, next)
      }
    } catch (failure) {
      setSelected(previous)
      setError(failure instanceof Error ? failure.message : 'the environment was not saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <select
        aria-label="Agent environment"
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        value={selected ?? ''}
        disabled={saving}
        onChange={(event) => void choose(event.target.value)}
      >
        <option value="">No environment</option>
        {available.map((environment) => (
          <option key={environment.id} value={environment.id}>
            {environment.name}
            {environment.containerId === null ? ' (stopped)' : ''}
          </option>
        ))}
      </select>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
}
