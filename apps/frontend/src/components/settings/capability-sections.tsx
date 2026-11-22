import { useEffect, useState } from 'react'

import type { CatalogEntry, CatalogTool, McpServer } from '../../lib/capability-api.ts'
import { credentialApi, listTools, promptApi, serverApi, syncTools } from '../../lib/capability-api.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Separator } from '../ui/separator.tsx'
import { Textarea } from '../ui/textarea.tsx'

/** A list that loads itself, because every catalog screen is the same three states. */
function useCatalog<T>(load: () => Promise<T[]>): {
  items: T[] | null
  error: string | null
  reload: () => void
} {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  // Loaded in an effect keyed on the counter, so "reload" is a state change rather than a second code path.
  useEffect(() => {
    let cancelled = false
    void load().then(
      (loaded) => {
        if (!cancelled) {
          setItems(loaded)
          setError(null)
        }
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'failed to load')
      },
    )

    return () => {
      cancelled = true
    }
    // `load` is a fresh closure every render; the counter is what says the data is stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  return { items, error, reload: () => setNonce((value) => value + 1) }
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start justify-between gap-4 rounded-md border p-3 text-sm">{children}</li>
}

function RowText({ title, meta, body }: { title: string; meta?: string; body?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-center gap-2 font-medium">
        {title}
        {meta === undefined ? null : (
          <Badge variant="secondary" className="text-[10px] font-normal">
            {meta}
          </Badge>
        )}
      </span>
      {body === undefined || body === '' ? null : (
        <span className="text-xs break-words text-muted-foreground">{body}</span>
      )}
    </div>
  )
}

/** Tools are synced from the registry, never authored here: the row is a pointer at code. */
export function ToolsSection() {
  const catalog = useCatalog<CatalogTool>(async () => await listTools())
  const [busy, setBusy] = useState(false)

  const sync = (): void => {
    setBusy(true)
    void syncTools()
      .then(() => catalog.reload())
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground">
          Read from the harness registry. A workspace or agent is granted these by id, so a tool disappears from the list
          when the registry stops offering it.
        </p>
        <Button variant="outline" size="sm" disabled={busy} onClick={sync}>
          {busy ? 'Syncing…' : 'Sync from registry'}
        </Button>
      </div>
      {catalog.error === null ? null : <p className="text-destructive">{catalog.error}</p>}
      <ul className="flex flex-col gap-2">
        {(catalog.items ?? []).map((tool) => (
          <Row key={tool.id}>
            <RowText title={tool.name} meta={tool.source} body={tool.description} />
          </Row>
        ))}
      </ul>
      {catalog.items !== null && catalog.items.length === 0 ? (
        <p className="text-muted-foreground">No tool has been synced yet.</p>
      ) : null}
    </div>
  )
}

/** Prompts and skills are the same shape, so one component serves both and the caller supplies the wording. */
export function TextCatalogSection({
  api,
  noun,
  hint,
}: {
  api: typeof promptApi
  noun: string
  hint: string
}) {
  const catalog = useCatalog<CatalogEntry>(async () => await api.list(false))
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = (): void => {
    if (name.trim() === '') return
    void api.create({ name, description, body }).then(
      () => {
        setName('')
        setDescription('')
        setBody('')
        setError(null)
        catalog.reload()
      },
      (failure: unknown) => setError(failure instanceof Error ? failure.message : 'failed to save'),
    )
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3 text-sm">
      <p className="text-muted-foreground">{hint}</p>
      {error === null ? null : <p className="text-destructive">{error}</p>}
      {catalog.error === null ? null : <p className="text-destructive">{catalog.error}</p>}

      <ul className="flex flex-col gap-2">
        {(catalog.items ?? []).map((entry) => (
          <Row key={entry.id}>
            <RowText title={entry.name} body={entry.description} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void api.setArchived(entry.id, true).then(() => catalog.reload())
              }}
            >
              Archive
            </Button>
          </Row>
        ))}
      </ul>

      <Separator />

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <span className="font-medium">New {noun}</span>
        <Input placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <Input
          placeholder="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Textarea
          placeholder="What the agent is told"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
        />
        <Button size="sm" className="w-fit" disabled={name.trim() === ''} onClick={create}>
          Create
        </Button>
      </div>
    </div>
  )
}

/** `VAR=secret-name` per line. The secret itself never travels through this app, only its name. */
const parseSecretMap = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.split('='))
      .filter((pair): pair is [string, string] => (pair[1] ?? '').trim() !== '')
      .map(([key, value]) => [key.trim(), value.trim()]),
  )

export function McpSection() {
  const catalog = useCatalog<McpServer>(async () => await serverApi.list(false))
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [endpoint, setEndpoint] = useState('')
  const [args, setArgs] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = (): void => {
    if (name.trim() === '' || endpoint.trim() === '') return
    const input =
      transport === 'stdio'
        ? {
            name,
            description: '',
            transport,
            command: endpoint,
            args: args.split('\n').filter((line) => line.trim() !== ''),
          }
        : { name, description: '', transport, url: endpoint }
    void serverApi.create(input).then(
      () => {
        setName('')
        setEndpoint('')
        setArgs('')
        setError(null)
        catalog.reload()
      },
      (failure: unknown) => setError(failure instanceof Error ? failure.message : 'failed to save'),
    )
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        A server row names the process or URL. Credentials are separate rows because one server can be reached with
        different secrets by different agents.
      </p>
      {error === null ? null : <p className="text-destructive">{error}</p>}
      {catalog.error === null ? null : <p className="text-destructive">{catalog.error}</p>}

      <ul className="flex flex-col gap-2">
        {(catalog.items ?? []).map((server) => (
          <ServerRow key={server.id} server={server} onChanged={catalog.reload} />
        ))}
      </ul>

      <Separator />

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <span className="font-medium">New server</span>
        <Input placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={transport === 'stdio' ? 'secondary' : 'ghost'}
            onClick={() => setTransport('stdio')}
          >
            stdio
          </Button>
          <Button size="sm" variant={transport === 'http' ? 'secondary' : 'ghost'} onClick={() => setTransport('http')}>
            http
          </Button>
        </div>
        <Input
          placeholder={transport === 'stdio' ? 'command' : 'url'}
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
        />
        {transport === 'stdio' ? (
          <Textarea placeholder="One argument per line" value={args} onChange={(event) => setArgs(event.target.value)} />
        ) : null}
        <Button size="sm" className="w-fit" disabled={name.trim() === '' || endpoint.trim() === ''} onClick={create}>
          Create
        </Button>
      </div>
    </div>
  )
}

function ServerRow({ server, onChanged }: { server: McpServer; onChanged: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <Row>
      <div className="flex min-w-0 flex-col gap-2">
        <RowText
          title={server.name}
          meta={server.transport}
          body={server.command ?? server.url ?? ''}
        />
        {open ? <CredentialList serverId={server.id} /> : null}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide credentials' : 'Credentials'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void serverApi.setArchived(server.id, true).then(onChanged)
          }}
        >
          Archive
        </Button>
      </div>
    </Row>
  )
}

function CredentialList({ serverId }: { serverId: string }) {
  const [label, setLabel] = useState('')
  const [consumer, setConsumer] = useState('')
  const [secrets, setSecrets] = useState('')
  const [nonce, setNonce] = useState(0)
  const [credentials, setCredentials] = useState<Awaited<ReturnType<typeof credentialApi.list>>>([])

  useEffect(() => {
    let cancelled = false
    void credentialApi.list(serverId).then((loaded) => {
      if (!cancelled) setCredentials(loaded)
    })

    return () => {
      cancelled = true
    }
  }, [serverId, nonce])

  return (
    <div className="flex flex-col gap-2 rounded-sm bg-muted/40 p-2 text-xs">
      <ul className="flex flex-col gap-1">
        {credentials.map((credential) => (
          <li key={credential.id} className="flex items-center justify-between gap-2">
            <span>
              {credential.label} · {credential.consumer}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void credentialApi.setArchived(credential.id, true).then(() => setNonce((value) => value + 1))
              }}
            >
              Archive
            </Button>
          </li>
        ))}
        {credentials.length === 0 ? <li className="text-muted-foreground">No credential yet.</li> : null}
      </ul>
      <Input placeholder="Label" value={label} onChange={(event) => setLabel(event.target.value)} />
      <Input placeholder="Consumer" value={consumer} onChange={(event) => setConsumer(event.target.value)} />
      <Textarea
        placeholder="ENV_VAR=secret-name, one per line"
        value={secrets}
        onChange={(event) => setSecrets(event.target.value)}
      />
      <Button
        size="sm"
        className="w-fit"
        disabled={label.trim() === '' || consumer.trim() === ''}
        onClick={() => {
          void credentialApi
            .create(serverId, { label, consumer, secretMap: parseSecretMap(secrets) })
            .then(() => {
              setLabel('')
              setConsumer('')
              setSecrets('')
              setNonce((value) => value + 1)
            })
        }}
      >
        Add credential
      </Button>
    </div>
  )
}
