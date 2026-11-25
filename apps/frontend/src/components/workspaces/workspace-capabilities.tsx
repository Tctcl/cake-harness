import { useEffect, useState } from 'react'

import type { WorkspaceGrantState } from '../../lib/capability-api.ts'
import { getWorkspaceGrants, listTools, promptApi, setWorkspaceGrants, skillApi, syncTools } from '../../lib/capability-api.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Separator } from '../ui/separator.tsx'
import { Spinner } from '../ui/spinner.tsx'
import { Textarea } from '../ui/textarea.tsx'

export type CapabilityKind = 'tools' | 'prompts' | 'skills'

/** The three catalogs differ in where their rows come from, not in what a workspace does with them: grant, or not. */
const CATALOG = {
  tools: {
    title: 'Tools',
    hint: 'What an agent in this workspace may call. The rows come from the harness registry, so a tool disappears from the list when the registry stops offering it.',
    load: async () => (await listTools()).map((tool) => ({ id: tool.id, name: tool.name, description: tool.description })),
  },
  prompts: {
    title: 'Prompts',
    hint: 'Instruction text this workspace may hand a run. Granting one is what puts it in front of the agent.',
    load: async () =>
      (await promptApi.list(false)).map((entry) => ({ id: entry.id, name: entry.name, description: entry.description })),
  },
  skills: {
    title: 'Skills',
    hint: 'Instruction packs this workspace may load. Nothing loads a skill into a run yet; the grant is what a run will read.',
    load: async () =>
      (await skillApi.list(false)).map((entry) => ({ id: entry.id, name: entry.name, description: entry.description })),
  },
} as const

interface CatalogRow {
  readonly id: string
  readonly name: string
  readonly description: string
}

/**
 * One capability catalog and the workspace's reach into it. The selection is saved as a whole, because the backend
 * replaces what a workspace may use rather than patching one id at a time.
 */
export function WorkspaceCapabilities({ workspaceId, kind }: { workspaceId: string; kind: CapabilityKind }) {
  const config = CATALOG[kind]
  const [state, setState] = useState<WorkspaceGrantState | null>(null)
  const [rows, setRows] = useState<CatalogRow[] | null>(null)
  const [selected, setSelected] = useState<readonly string[]>([])
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([getWorkspaceGrants(workspaceId), config.load()]).then(
      ([grants, catalog]) => {
        if (cancelled) return
        setState(grants)
        setSelected(grants.grants[kind])
        setRows(catalog)
        setError(null)
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'the catalog failed to load')
      },
    )

    return () => {
      cancelled = true
    }
    // `config` follows `kind`, which is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, kind, nonce])

  const toggle = (id: string): void =>
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the selection could not be saved')
    } finally {
      setBusy(false)
      setNonce((value) => value + 1)
    }
  }

  const save = (): void => {
    if (state === null) return
    void run(async () => {
      const saved = await setWorkspaceGrants(workspaceId, {
        allowAll: state.allowAll,
        grants: { ...state.grants, [kind]: selected },
      })
      setState(saved)
    })
  }

  if (state === null || rows === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {error === null ? (
          <>
            <Spinner /> Loading {config.title.toLowerCase()}…
          </>
        ) : (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        )}
      </p>
    )
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3 text-sm">
      <p className="text-muted-foreground">{config.hint}</p>

      {state.allowAll ? (
        <p className="rounded-md border border-dashed p-3 text-muted-foreground">
          This workspace reaches everything, so the selection below is not what limits a run. Turn that off on the Overview
          tab to make it count.
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground">Nothing is in this catalog yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3 rounded-md border p-3">
              <input
                type="checkbox"
                id={`${kind}-${row.id}`}
                className="mt-0.5 size-4 shrink-0 accent-foreground"
                checked={selected.includes(row.id)}
                onChange={() => toggle(row.id)}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <label htmlFor={`${kind}-${row.id}`} className="font-medium">
                  {row.name}
                </label>
                {row.description === '' ? null : (
                  <span className="text-xs break-words text-muted-foreground">{row.description}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={save}>
          Save selection
        </Button>
        {kind === 'tools' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(async () => await syncTools())}
          >
            Sync from registry
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">{selected.length} granted</span>
      </div>

      {kind === 'tools' ? null : (
        <>
          <Separator />
          <NewEntry kind={kind} onCreated={() => setNonce((value) => value + 1)} />
        </>
      )}
    </div>
  )
}

/** Prompts and skills are authored here now; both catalogs are shared, so a row created here is grantable anywhere. */
function NewEntry({ kind, onCreated }: { kind: Exclude<CapabilityKind, 'tools'>; onCreated: () => void }) {
  const api = kind === 'prompts' ? promptApi : skillApi
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim() === '') return

        setBusy(true)
        void api.create({ name, description, body }).then(
          () => {
            setName('')
            setDescription('')
            setBody('')
            setError(null)
            onCreated()
          },
          (failure: unknown) => setError(failure instanceof Error ? failure.message : 'it could not be saved'),
        ).finally(() => setBusy(false))
      }}
    >
      <span className="font-medium">New {kind === 'prompts' ? 'prompt' : 'skill'}</span>
      <Input aria-label="Name" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
      <Input
        aria-label="Description"
        placeholder="Description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <Textarea
        aria-label="Text the agent is given"
        placeholder="Text the agent is given"
        rows={4}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <Button type="submit" size="sm" className="w-fit" disabled={busy || name.trim() === ''}>
        Create
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
