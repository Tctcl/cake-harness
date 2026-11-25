import { PlusIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { McpServerInput, McpTransport, WorkspaceMcpServer } from '../../lib/capability-api.ts'
import { workspaceServerApi } from '../../lib/capability-api.ts'
import type { Credential } from '../../lib/credentials-api.ts'
import { listCredentials } from '../../lib/credentials-api.ts'
import { MasterDetail, NEW_SELECTION } from '../layout/master-detail.tsx'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Spinner } from '../ui/spinner.tsx'

interface EnvRow {
  readonly name: string
  readonly value: string
}

/**
 * The editor's own shape of a server. `rows` is what the user types: the executable first, then one row per argument, so
 * `["npx", "-y", "example-mcp-server"]` is three text boxes rather than one line to be split on spaces.
 */
interface Draft {
  readonly id: string | null
  readonly name: string
  readonly description: string
  readonly transport: McpTransport
  readonly rows: readonly string[]
  readonly cwd: string
  readonly url: string
  readonly env: readonly EnvRow[]
  /** The id a credential is filed under, so the dropdown below can offer the keys written for this server. */
  readonly mcpId: string
  readonly credentialId: string
}

const EMPTY: Draft = {
  id: null,
  name: '',
  description: '',
  transport: 'stdio',
  rows: [''],
  cwd: '',
  url: '',
  env: [],
  mcpId: '',
  credentialId: '',
}

const toDraft = (server: WorkspaceMcpServer): Draft => ({
  id: server.id,
  name: server.name,
  description: server.description,
  transport: server.transport,
  rows: [server.command ?? '', ...server.args],
  cwd: server.cwd ?? '',
  url: server.url ?? '',
  env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
  mcpId: server.mcpId ?? '',
  credentialId: server.credentialId ?? '',
})

const toInput = (draft: Draft): McpServerInput => {
  const rows = draft.rows.map((row) => row.trim())
  // Both transports carry them: which key a server uses says nothing about how it is reached.
  const identity = {
    mcpId: draft.mcpId.trim(),
    credentialId: draft.credentialId === '' ? null : draft.credentialId,
  }
  const base = { name: draft.name.trim(), description: draft.description, ...identity }

  if (draft.transport === 'http') return { ...base, transport: 'http', url: draft.url.trim() }

  return {
    ...base,
    transport: 'stdio',
    command: rows[0] ?? '',
    args: rows.slice(1).filter((row) => row !== ''),
    cwd: draft.cwd.trim(),
    env: Object.fromEntries(
      draft.env
        .filter((row) => row.name.trim() !== '')
        .map((row) => [row.name.trim(), row.value]),
    ),
  }
}

const summaryOf = (server: WorkspaceMcpServer): string =>
  server.transport === 'http'
    ? (server.url ?? '')
    : [server.command ?? '', ...server.args].filter((part) => part !== '').join(' ')

/**
 * The MCP servers of one workspace. A server is the workspace's own because its process runs in that workspace's
 * container: `cwd` and every variable below it only mean anything there.
 */
export function WorkspaceMcp({ workspaceId }: { workspaceId: string }) {
  const [servers, setServers] = useState<WorkspaceMcpServer[] | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The keys this user owns. They are read once: a key added on the credentials page is picked up on the next visit.
  const [credentials, setCredentials] = useState<readonly Credential[]>([])

  useEffect(() => {
    let cancelled = false
    void listCredentials().then(
      (loaded) => {
        if (!cancelled) setCredentials(loaded)
      },
      () => undefined,
    )

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void workspaceServerApi.list(workspaceId).then(
      (loaded) => {
        if (!cancelled) {
          setServers(loaded)
          setError(null)
        }
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'the servers failed to load')
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId, nonce])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the server could not be saved')
    } finally {
      setBusy(false)
      setNonce((value) => value + 1)
    }
  }

  const canSave =
    draft.name.trim() !== '' &&
    (draft.transport === 'http' ? draft.url.trim() !== '' : (draft.rows[0] ?? '').trim() !== '')

  const save = (): void => {
    if (!canSave) return
    const input = toInput(draft)

    void run(async () => {
      const saved = draft.id === null
        ? await workspaceServerApi.create(workspaceId, input)
        : await workspaceServerApi.update(workspaceId, draft.id, input)
      setSelection(saved.id)
      setDraft(toDraft(saved))
    })
  }

  const patch = (next: Partial<Draft>): void => setDraft((current) => ({ ...current, ...next }))

  const setRow = (index: number, value: string): void =>
    patch({ rows: draft.rows.map((row, position) => (position === index ? value : row)) })

  const select = (id: string | null): void => {
    setSelection(id)
    if (id === NEW_SELECTION) setDraft(EMPTY)
    else {
      const server = servers?.find((candidate) => candidate.id === id)
      if (server !== undefined) setDraft(toDraft(server))
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="max-w-3xl text-muted-foreground">
        Started inside this workspace&rsquo;s container when a run needs them. A server here reaches this workspace and
        no other.
      </p>
      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {servers === null ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Spinner /> Loading servers…
        </p>
      ) : (
        <MasterDetail
          listLabel="MCP servers"
          newLabel="New server"
          items={servers.map((server) => ({
            id: server.id,
            name: server.name,
            detail: server.description || summaryOf(server),
            badge: (
              <Badge variant="secondary" className="text-[10px] font-normal">
                {server.transport}
              </Badge>
            ),
          }))}
          selection={selection}
          onSelect={select}
          emptyText="No MCP server is configured for this workspace yet."
          renderDetail={() => (
      <form
        className="flex flex-col gap-3 rounded-md border p-4"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <span className="font-medium">{draft.id === null ? 'New server' : `Editing ${draft.name}`}</span>

        <div className="flex flex-col gap-1">
          <label htmlFor="mcp-name" className="font-medium">
            Name
          </label>
          <Input
            id="mcp-name"
            placeholder="github"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="mcp-description" className="font-medium">
            Description
          </label>
          <Input
            id="mcp-description"
            placeholder="What the server gives a run"
            value={draft.description}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="mcp-id" className="font-medium">
            MCP id
          </label>
          <Input
            id="mcp-id"
            className="font-mono"
            placeholder="github"
            value={draft.mcpId}
            onChange={(event) => patch({ mcpId: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            The id this server is filed under. Keys written on the credentials page for the same id are offered below.
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="mcp-credential" className="font-medium">
            Credential
          </label>
          <select
            id="mcp-credential"
            className="h-9 w-fit max-w-full rounded-md border bg-transparent px-2 text-sm"
            value={draft.credentialId}
            onChange={(event) => patch({ credentialId: event.target.value })}
          >
            <option value="">No credential</option>
            {credentials
              .filter((credential) => credential.kind === 'mcp' && credential.mcpId === draft.mcpId.trim())
              .map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.name}
                </option>
              ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {draft.mcpId.trim() === ''
              ? 'Set an MCP id to choose from the keys filed under it.'
              : 'The keys filed under this MCP id. New ones are added on the credentials page.'}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="mcp-transport" className="font-medium">
            Transport
          </label>
          <select
            id="mcp-transport"
            className="h-9 w-fit rounded-md border bg-transparent px-2 text-sm"
            value={draft.transport}
            onChange={(event) => patch({ transport: event.target.value === 'http' ? 'http' : 'stdio' })}
          >
            <option value="stdio">stdio — a command run in the container</option>
            <option value="http">http — an endpoint</option>
          </select>
        </div>

        {draft.transport === 'http' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="mcp-url" className="font-medium">
              URL
            </label>
            <Input
              id="mcp-url"
              placeholder="https://example.com/mcp"
              value={draft.url}
              onChange={(event) => patch({ url: event.target.value })}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="font-medium">Command</span>
              <span className="text-xs text-muted-foreground">
                One box per word of the command line: <code className="font-mono">npx</code>, then{' '}
                <code className="font-mono">-y</code>, then the package.
              </span>
              <div className="flex flex-col gap-2">
                {draft.rows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      aria-label={index === 0 ? 'Command' : `Argument ${index}`}
                      placeholder={index === 0 ? 'npx' : '-y'}
                      className="font-mono"
                      value={row}
                      onChange={(event) => setRow(index, event.target.value)}
                    />
                    {index === 0 ? null : (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove argument ${index}`}
                        onClick={() => patch({ rows: draft.rows.filter((_, position) => position !== index) })}
                      >
                        <XIcon className="size-4" aria-hidden />
                      </Button>
                    )}
                    {index === draft.rows.length - 1 ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label="Add an argument"
                        onClick={() => patch({ rows: [...draft.rows, ''] })}
                      >
                        <PlusIcon className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="mcp-cwd" className="font-medium">
                Working directory
              </label>
              <Input
                id="mcp-cwd"
                placeholder="/workspace"
                className="font-mono"
                value={draft.cwd}
                onChange={(event) => patch({ cwd: event.target.value })}
              />
              <span className="text-xs text-muted-foreground">
                Where the process starts, inside the container. Left empty it starts in the container&rsquo;s own working
                directory.
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium">Variables</span>
              <span className="text-xs text-muted-foreground">
                Handed to the process as its environment. A value that is a secret belongs on a credential, not here.
              </span>
              {draft.env.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  {draft.env.map((row, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        aria-label={`Variable ${index + 1} name`}
                        placeholder="GITHUB_HOST"
                        className="font-mono"
                        value={row.name}
                        onChange={(event) =>
                          patch({
                            env: draft.env.map((entry, position) =>
                              position === index ? { ...entry, name: event.target.value } : entry,
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label={`Variable ${index + 1} value`}
                        placeholder="github.example.com"
                        className="font-mono"
                        value={row.value}
                        onChange={(event) =>
                          patch({
                            env: draft.env.map((entry, position) =>
                              position === index ? { ...entry, value: event.target.value } : entry,
                            ),
                          })
                        }
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove variable ${index + 1}`}
                        onClick={() => patch({ env: draft.env.filter((_, position) => position !== index) })}
                      >
                        <XIcon className="size-4" aria-hidden />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={() => patch({ env: [...draft.env, { name: '', value: '' }] })}
              >
                <PlusIcon className="size-4" aria-hidden />
                Add variable
              </Button>
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || !canSave}>
            {draft.id === null ? 'Add server' : 'Save'}
          </Button>
          {draft.id === null ? null : (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={() => select(selection)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto text-destructive"
                disabled={busy}
                onClick={() => {
                  const id = draft.id
                  if (id === null) return
                  setSelection(null)
                  void run(async () => await workspaceServerApi.remove(workspaceId, id))
                }}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </form>
          )
        }
        />
      )}
    </div>
  )
}
