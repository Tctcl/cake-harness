import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { SshAccess, SshTunnel } from '../../lib/ssh-api.ts'
import { getSshAccess, listSshTunnels } from '../../lib/ssh-api.ts'
import { Button } from '../ui/button.tsx'

/** A command with the button that puts it on the clipboard; the button is labelled with what it copies. */
function CopyRow({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return

    const timer = window.setTimeout(() => setCopied(false), 1_500)

    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 overflow-hidden text-xs break-all text-muted-foreground">{command}</code>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        aria-label={`Copy ${label}`}
        onClick={() => {
          // The clipboard is denied in some contexts; the command is on screen and selectable either way.
          void navigator.clipboard?.writeText(command).then(() => setCopied(true), () => undefined)
        }}
      >
        <Copy className="size-3" />
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </div>
  )
}

/**
 * How to get into the container by hand and what is currently forwarded through it. Both are the container's, so a
 * conversation without one has nothing to show here.
 */
export function SshCard({ environmentId }: { environmentId: string }) {
  const [access, setAccess] = useState<SshAccess | null>(null)
  const [tunnels, setTunnels] = useState<readonly SshTunnel[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void Promise.all([getSshAccess(environmentId), listSshTunnels(environmentId)]).then(
      ([loadedAccess, loadedTunnels]) => {
        if (cancelled) return
        setAccess(loadedAccess)
        setTunnels(loadedTunnels)
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'ssh access failed to load')
      },
    )

    return () => {
      cancelled = true
    }
  }, [environmentId])

  return (
    <div className="flex flex-col gap-2">
      {access === null ? (
        <p className="text-xs text-muted-foreground">No SSH access for this container yet.</p>
      ) : (
        <>
          <span className="text-xs text-muted-foreground">
            {access.user}@{access.host}, port {access.port}
          </span>
          <CopyRow label="SSH command" command={access.command} />
        </>
      )}

      {tunnels.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Tunnels</span>
          {tunnels.map((tunnel) => (
            <CopyRow key={tunnel.id} label={`tunnel ${tunnel.localPort}`} command={tunnel.command} />
          ))}
        </div>
      )}

      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
