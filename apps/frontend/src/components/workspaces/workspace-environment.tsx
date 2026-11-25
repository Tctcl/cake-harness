import { useEffect, useState } from 'react'

import type { DevEnvironment, EnvironmentDetail, SshAccess } from '../../lib/environment-api.ts'
import {
  getEnvironment,
  getEnvironmentSsh,
  getWorkspaceEnvironment,
  setWorkspaceImage,
  startEnvironment,
  stopEnvironment,
} from '../../lib/environment-api.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Spinner } from '../ui/spinner.tsx'
import { EnvironmentSsh } from './environment-ssh.tsx'
import { EnvironmentResources } from './environment-resources.tsx'

interface EnvironmentSnapshot {
  readonly environment: EnvironmentDetail | null
  readonly ssh: SshAccess | null
}

type BusyAction = 'start' | 'stop' | 'restart' | 'image' | null

const readSnapshot = async (workspaceId: string): Promise<EnvironmentSnapshot> => {
  const attached = await getWorkspaceEnvironment(workspaceId)
  if (attached === null) return { environment: null, ssh: null }

  const [environment, ssh] = await Promise.all([getEnvironment(attached.id), getEnvironmentSsh(attached.id)])
  return { environment, ssh }
}

const message = (failure: unknown, fallback: string): string =>
  failure instanceof Error ? failure.message : fallback

const statusLabel = (status: EnvironmentDetail['status']): string => {
  if (status === 'running') return 'Running'
  if (status === 'stopped') return 'Stopped'
  return 'Missing'
}

/** The user-facing controls for the workspace's one container; General's agent-tool exclusion is deliberately separate. */
export function WorkspaceEnvironmentPanel({
  workspaceId,
  workspaceName,
  isDefault,
  onOpenSshKeys,
  onOpenTerminal,
}: {
  workspaceId: string
  workspaceName: string
  isDefault: boolean
  onOpenSshKeys: () => void
  onOpenTerminal: (workspaceId: string) => void
}) {
  const [environment, setEnvironment] = useState<EnvironmentDetail | null>(null)
  const [ssh, setSsh] = useState<SshAccess | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [image, setImage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<BusyAction>(null)

  useEffect(() => {
    let cancelled = false
    void readSnapshot(workspaceId).then(
      (snapshot) => {
        if (cancelled) return
        setEnvironment(snapshot.environment)
        setSsh(snapshot.ssh)
        setImage(snapshot.environment?.image ?? '')
        setLoaded(true)
      },
      (failure: unknown) => {
        if (cancelled) return
        setError(message(failure, 'the environment failed to load'))
        setLoaded(true)
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  async function changeState(action: Exclude<BusyAction, 'image' | null>) {
    if (environment === null) return
    setBusy(action)
    setError(null)

    try {
      if (action === 'stop' || action === 'restart') await stopEnvironment(environment.id)
      if (action === 'start' || action === 'restart') await startEnvironment(environment.id)
      const snapshot = await readSnapshot(workspaceId)
      if (snapshot.environment === null) throw new Error('the environment disappeared while changing state')
      setEnvironment(snapshot.environment)
      setSsh(snapshot.ssh)
    } catch (failure) {
      setError(message(failure, 'the container did not change state'))
    } finally {
      setBusy(null)
    }
  }

  async function saveImage(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = image.trim()
    if (trimmed === '') return

    setBusy('image')
    setError(null)
    try {
      const saved: DevEnvironment = await setWorkspaceImage(workspaceId, trimmed)
      setEnvironment((current) => current === null ? null : { ...current, ...saved })
      setImage(saved.image)
    } catch (failure) {
      setError(message(failure, 'the image could not be saved'))
    } finally {
      setBusy(null)
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
    return <p role="alert" className="text-sm text-destructive">{error}</p>
  }

  if (environment === null) {
    return (
      <div className="flex max-w-prose flex-col gap-2 rounded-md border border-dashed p-4 text-sm">
        <span className="font-medium">No environment attached</span>
        <span className="text-muted-foreground">
          This workspace is missing its required container. Restarting the backend repairs the attachment at startup.
        </span>
      </div>
    )
  }

  const running = environment.status === 'running'

  return (
    <div className="flex max-w-4xl flex-col gap-4 text-sm">
      {isDefault ? (
        <p className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
          General’s agent never uses this container directly; it is reserved for skills, MCP servers, and your terminal.
        </p>
      ) : null}

      <section aria-label="Container status" className="flex flex-col gap-3 rounded-md border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Container</h2>
          <Badge variant={running ? 'default' : 'secondary'}>{statusLabel(environment.status)}</Badge>
          <div className="ml-auto flex flex-wrap gap-2">
            {running ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  aria-busy={busy === 'restart'}
                  onClick={() => void changeState('restart')}
                >
                  {busy === 'restart' ? 'Restarting…' : 'Restart'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  aria-busy={busy === 'stop'}
                  onClick={() => void changeState('stop')}
                >
                  {busy === 'stop' ? 'Stopping…' : 'Stop'}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={busy !== null}
                aria-busy={busy === 'start'}
                onClick={() => void changeState('start')}
              >
                {busy === 'start' ? 'Starting…' : 'Start'}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {environment.containerId === null
            ? 'The container has not been created yet. Start it from the image below.'
            : `Container ${environment.containerId}`}
        </p>

        <details className="rounded-md border bg-muted/20 p-3">
          <summary className="cursor-pointer font-medium">Image</summary>
          <form className="mt-3 flex flex-col gap-2" onSubmit={(event) => void saveImage(event)}>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Container image"
                value={image}
                placeholder="node:26"
                onChange={(event) => setImage(event.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                disabled={busy !== null || image.trim() === '' || image.trim() === environment.image}
              >
                {busy === 'image' ? 'Saving…' : 'Save'}
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              An image change applies the next time a missing container is created; a running container keeps its image.
            </span>
          </form>
        </details>
      </section>

      {running ? (
        <EnvironmentResources environmentId={environment.id} />
      ) : (
        <p className="rounded-md border border-dashed p-4 text-muted-foreground">
          Start the container to see live resource usage.
        </p>
      )}

      <section aria-label="Terminal access" className="flex items-center justify-between gap-4 rounded-md border p-4">
        <div>
          <h2 className="font-medium">Terminal</h2>
          <p className="text-xs text-muted-foreground">Open a shell in this workspace’s container.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => onOpenTerminal(workspaceId)}>
          Open terminal
        </Button>
      </section>

      <EnvironmentSsh
        environmentId={environment.id}
        workspaceName={workspaceName}
        access={ssh}
        onOpenSshKeys={onOpenSshKeys}
      />

      <section aria-label="Tooling — coming next" className="rounded-md border border-dashed p-4">
        <h2 className="font-medium">Tooling — coming next</h2>
        <p className="mt-1 text-muted-foreground">Tool installation and environment configuration will be managed here.</p>
      </section>

      {error === null ? null : <p role="alert" className="text-destructive">{error}</p>}
    </div>
  )
}
