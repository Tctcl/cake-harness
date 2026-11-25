import { useEffect, useState } from 'react'

import type { DevEnvironment } from '../../lib/environment-api.ts'
import { getWorkspaceEnvironment, setWorkspaceImage } from '../../lib/environment-api.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Spinner } from '../ui/spinner.tsx'

/**
 * The container a workspace's MCP servers and terminals run in. The image is the only field that is the user's to set
 * today; the rest of a container's shape (tooling, variables, mounts, limits) is named here so the tab reads as a
 * checklist of what is coming rather than as an empty form.
 */
export function WorkspaceEnvironmentPanel({ workspaceId }: { workspaceId: string }) {
  const [environment, setEnvironment] = useState<DevEnvironment | null>(null)
  // A workspace with no environment and a workspace whose environment is still loading are different states.
  const [loaded, setLoaded] = useState(false)
  const [image, setImage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getWorkspaceEnvironment(workspaceId).then(
      (found) => {
        if (cancelled) return
        setEnvironment(found)
        setImage(found?.image ?? '')
        setLoaded(true)
      },
      (failure: unknown) => {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : 'the environment failed to load')
        setLoaded(true)
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = image.trim()
    if (trimmed === '') return

    setBusy(true)
    try {
      setEnvironment(await setWorkspaceImage(workspaceId, trimmed))
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the image could not be saved')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading the environment…
      </p>
    )
  }

  if (error !== null && environment === null) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  }

  if (environment === null) {
    return (
      <div className="flex max-w-prose flex-col gap-2 rounded-md border border-dashed p-4 text-sm">
        <span className="font-medium">No environment attached</span>
        <span className="text-muted-foreground">
          This workspace is attached to no environment, so nothing here can start a container. Attaching one is what
          gives its MCP servers and terminals a machine to run in.
        </span>
      </div>
    )
  }

  return (
    <div className="flex max-w-prose flex-col gap-6 text-sm">
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="environment-image" className="font-medium">
            Image
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="environment-image"
              value={image}
              placeholder="node:26"
              onChange={(event) => setImage(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={busy || image.trim() === '' || image.trim() === environment.image}>
              Save
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            The image the container is created from. A container already running keeps the image it started with, so a
            change applies to the next start.
          </span>
        </div>
      </form>

      <div className="flex flex-col gap-2 rounded-md border p-4">
        <span className="flex items-center gap-2 font-medium">
          Container
          {environment.containerId === null ? (
            <Badge variant="secondary" className="text-[10px] font-normal">
              Not started
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] font-normal">
              Running
            </Badge>
          )}
        </span>
        <span className="text-muted-foreground">
          {environment.containerId === null
            ? 'Nothing has started this workspace’s container yet. It is created from the image above the first time something runs in it.'
            : `Reached through the container Cake started for this workspace, ${environment.containerId}.`}
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-dashed p-4">
        <span className="font-medium">Not built yet</span>
        <span className="text-muted-foreground">
          Tooling installed into the image, extra variables, volumes and the resource limits all change what the container
          is; none of them has a column or a control yet, so this tab does not pretend to edit them.
        </span>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
