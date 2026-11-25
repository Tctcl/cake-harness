import { useEffect, useState } from 'react'

import type { ListeningPort, SshAccess } from '../../lib/environment-api.ts'
import { getEnvironmentPorts } from '../../lib/environment-api.ts'
import { listSshKeys } from '../../lib/ssh-keys-api.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'

const IDENTITY_FILE_KEY = 'cake.ssh.identity-file'
const DEFAULT_IDENTITY_FILE = '~/.ssh/cake_ed25519'

const readIdentityFile = (): string => {
  try {
    return window.localStorage.getItem(IDENTITY_FILE_KEY) ?? DEFAULT_IDENTITY_FILE
  } catch {
    return DEFAULT_IDENTITY_FILE
  }
}

const aliasOf = (workspaceName: string): string => {
  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

  return `cake-${slug || 'workspace'}`
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => {
              setCopied(true)
              setFailed(false)
            },
            () => {
              setCopied(false)
              setFailed(true)
            },
          )
        }}
      >
        {label}
      </Button>
      {copied ? <output className="text-xs text-muted-foreground">Copied</output> : null}
      {failed ? <span role="alert" className="text-xs text-destructive">Could not copy.</span> : null}
    </span>
  )
}

function ListeningPorts({ environmentId, running, alias }: { environmentId: string; running: boolean; alias: string }) {
  const [ports, setPorts] = useState<readonly ListeningPort[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!running) return

    let active = true
    let reading = false
    let timer: number | undefined

    const read = async () => {
      if (!active || document.hidden || reading) return
      reading = true
      try {
        const loaded = await getEnvironmentPorts(environmentId)
        if (active) {
          setPorts(loaded)
          setError(null)
        }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'listening ports could not be read')
      } finally {
        reading = false
      }
    }
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer)
      timer = undefined
    }
    const start = () => {
      if (!document.hidden && timer === undefined) {
        void read()
        timer = window.setInterval(() => void read(), 10_000)
      }
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
  }, [environmentId, refresh, running])

  return (
    <section aria-label="Listening ports" className="flex flex-col gap-3 border-t pt-3">
      <div className="flex items-center gap-2">
        <h3 className="font-medium">Listening ports</h3>
        <Button type="button" size="sm" variant="outline" disabled={!running} onClick={() => setRefresh((value) => value + 1)}>
          Refresh
        </Button>
      </div>
      {!running ? (
        <p className="text-xs text-muted-foreground">Start the container to see its listening ports.</p>
      ) : ports.length === 0 ? (
        <p className="text-xs text-muted-foreground">No development servers are listening.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ports.map(({ port, command }) => (
            <li key={port} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">:{port}</span>
              <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted p-2 text-xs">
                {command.replace(/ cake-[^\s]+$/, ` ${alias}`)}
              </code>
              <CopyButton label={`Copy port ${port} command`} value={command.replace(/ cake-[^\s]+$/, ` ${alias}`)} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">VS Code forwards these ports automatically when connected.</p>
      {error === null ? null : <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  )
}

export function EnvironmentSsh({
  environmentId,
  workspaceName,
  access,
  onOpenSshKeys,
}: {
  environmentId: string
  workspaceName: string
  access: SshAccess | null
  onOpenSshKeys: () => void
}) {
  const [identityFile, setIdentityFile] = useState(readIdentityFile)
  const [hasKeys, setHasKeys] = useState<boolean | null>(null)
  const [keysError, setKeysError] = useState<string | null>(null)
  const alias = aliasOf(workspaceName)

  useEffect(() => {
    let active = true
    void listSshKeys().then(
      (keys) => {
        if (active) setHasKeys(keys.length > 0)
      },
      (failure: unknown) => {
        if (active) setKeysError(failure instanceof Error ? failure.message : 'SSH keys could not be loaded')
      },
    )

    return () => {
      active = false
    }
  }, [])

  if (access === null) {
    return <p className="text-muted-foreground">SSH is not available for this container.</p>
  }

  const config = [
    `Host ${alias}`,
    `    HostName ${access.host}`,
    `    Port ${access.port}`,
    `    User ${access.user}`,
    `    IdentityFile ${identityFile}`,
    '    IdentitiesOnly yes',
    '    ServerAliveInterval 60',
    '    ServerAliveCountMax 3',
  ].join('\n')
  const command = `ssh ${alias}`
  const vscodeHref = `vscode://vscode-remote/ssh-remote+${alias}/home/dev/workspace`

  return (
    <section aria-label="SSH access" className="flex flex-col gap-3 rounded-md border p-4">
      <div>
        <h2 className="font-medium">SSH</h2>
        <p className="text-xs text-muted-foreground">Connect to the workspace from your computer or VS Code.</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Host</dt><dd className="font-mono">{access.host}</dd>
        <dt className="text-muted-foreground">Port</dt><dd className="font-mono">{access.port}</dd>
        <dt className="text-muted-foreground">User</dt><dd className="font-mono">{access.user}</dd>
        <dt className="text-muted-foreground">Alias</dt><dd className="font-mono">{alias}</dd>
      </dl>
      {!access.running ? <p className="text-xs text-muted-foreground">Start the container before connecting over SSH.</p> : null}

      <div className="flex flex-col gap-2">
        <label htmlFor="ssh-identity-file" className="font-medium">Identity file path</label>
        <Input
          id="ssh-identity-file"
          className="font-mono"
          value={identityFile}
          onChange={(event) => {
            const value = event.target.value
            setIdentityFile(value)
            try {
              window.localStorage.setItem(IDENTITY_FILE_KEY, value)
            } catch {
              setKeysError('This browser could not save the identity file path.')
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">SSH config</h3>
        <CopyButton label="Copy SSH config" value={config} />
      </div>
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>{config}</code></pre>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md bg-muted p-2 text-xs">{command}</code>
        <CopyButton label="Copy SSH command" value={command} />
        <a className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted" href={vscodeHref}>
          Open in VS Code
        </a>
      </div>
      <ol className="list-inside list-decimal text-xs text-muted-foreground">
        <li>Save your private key in <code>~/.ssh</code>.</li>
        <li>Paste this block into <code>~/.ssh/config</code>.</li>
        <li>Click Open in VS Code to connect to <code>/home/dev/workspace</code>.</li>
      </ol>
      {hasKeys === false ? (
        <p className="rounded-md border border-primary/40 bg-primary/5 p-3">
          Add an SSH key before connecting.{' '}
          <button type="button" className="font-medium underline" onClick={onOpenSshKeys}>
            Manage keys in Settings → SSH keys
          </button>
        </p>
      ) : null}
      {keysError === null ? null : <p role="alert" className="text-xs text-destructive">{keysError}</p>}

      <ListeningPorts environmentId={environmentId} running={access.running} alias={alias} />
    </section>
  )
}
