import { useEffect, useState } from 'react'

import type { CatalogEntry, WorkspaceGrantState } from '../../lib/capability-api.ts'
import { getWorkspaceGrants, setWorkspaceGrants, skillApi } from '../../lib/capability-api.ts'
import { MasterDetail, NEW_SELECTION } from '../layout/master-detail.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Label } from '../ui/label.tsx'
import { Spinner } from '../ui/spinner.tsx'
import { Textarea } from '../ui/textarea.tsx'

const messageOf = (failure: unknown, fallback: string): string => (failure instanceof Error ? failure.message : fallback)

interface SkillInput {
  readonly name: string
  readonly description: string
  readonly body: string
}

/** Skills are authored here and granted to this workspace; agents choose their tools in their own editors. */
export function WorkspaceCapabilities({ workspaceId }: { workspaceId: string }) {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null)
  const [archived, setArchived] = useState<CatalogEntry[]>([])
  const [grants, setGrants] = useState<WorkspaceGrantState | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      skillApi.list(false),
      skillApi.list(true),
      getWorkspaceGrants(workspaceId),
    ]).then(
      ([live, gone, linked]) => {
        if (cancelled) return
        setEntries(live)
        setArchived(gone)
        setGrants(linked)
        setError(null)
      },
      (failure: unknown) => {
        if (!cancelled) setError(messageOf(failure, 'the skills failed to load'))
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId, nonce])

  const reload = (): void => setNonce((value) => value + 1)

  const run = (action: () => Promise<unknown>): void => {
    setBusy(true)
    setError(null)
    void action().then(() => {
      setBusy(false)
      reload()
    }, (failure: unknown) => {
      setBusy(false)
      setError(messageOf(failure, 'the skill could not be saved'))
    })
  }

  const save = (entry: CatalogEntry | undefined, input: SkillInput, granted: boolean): void => {
    if (grants === null) return
    void run(async () => {
      const saved = entry === undefined ? await skillApi.create(input) : await skillApi.update(entry.id, input)
      const without = grants.grants.skills.filter((id) => id !== saved.id)
      await setWorkspaceGrants(workspaceId, {
        allowAll: grants.allowAll,
        grants: { skills: granted ? [...without, saved.id] : without },
      })
      setSelection(saved.id)
    })
  }

  if (entries === null || grants === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {error === null ? (
          <>
            <Spinner /> Loading skills…
          </>
        ) : (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        )}
      </p>
    )
  }

  const archivedGroup = archived.length === 0 ? null : (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Archived skills ({archived.length})</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {archived.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(async () => await skillApi.setArchived(entry.id, false))}
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() => void run(async () => await skillApi.remove(entry.id))}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </details>
  )

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="max-w-3xl text-muted-foreground">
        Instruction packs this workspace may load. Nothing loads a skill into a run yet; the grant is what a run will read.
      </p>
      {grants.allowAll ? (
        <p className="rounded-md border border-dashed p-3 text-muted-foreground">
          This workspace reaches every skill, so individual selections do not narrow it.
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <MasterDetail
        listLabel="Skills"
        newLabel="New skill"
        items={entries.map((entry) => ({ id: entry.id, name: entry.name, detail: entry.description }))}
        selection={selection}
        onSelect={setSelection}
        emptyText="No skills yet."
        archived={archivedGroup}
        renderDetail={(item) => {
          const entry = entries.find((candidate) => candidate.id === item?.id)
          return (
            <SkillEditor
              key={`${item?.id ?? NEW_SELECTION}-${nonce}`}
              entry={entry}
              granted={entry !== undefined && grants.grants.skills.includes(entry.id)}
              busy={busy}
              onSave={(input, granted) => save(entry, input, granted)}
              onArchive={entry === undefined ? undefined : () => {
                setSelection(null)
                void run(async () => await skillApi.setArchived(entry.id, true))
              }}
            />
          )
        }}
      />
    </div>
  )
}

function SkillEditor({
  entry,
  granted,
  busy,
  onSave,
  onArchive,
}: {
  entry: CatalogEntry | undefined
  granted: boolean
  busy: boolean
  onSave: (input: SkillInput, granted: boolean) => void
  onArchive: (() => void) | undefined
}) {
  const [name, setName] = useState(entry?.name ?? '')
  const [description, setDescription] = useState(entry?.description ?? '')
  const [body, setBody] = useState(entry?.body ?? '')
  const [available, setAvailable] = useState(granted)

  return (
    <form
      aria-label={entry === undefined ? 'New skill' : `Edit ${entry.name}`}
      className="flex max-w-2xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim() !== '') onSave({ name: name.trim(), description, body }, available)
      }}
    >
      <h2 className="font-medium">{entry === undefined ? 'New skill' : entry.name}</h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor="skill-name">Name</Label>
        <Input id="skill-name" required value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="skill-description">Description</Label>
        <Input
          id="skill-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="skill-body">Text the agent is given</Label>
        <Textarea id="skill-body" rows={7} value={body} onChange={(event) => setBody(event.target.value)} />
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-foreground"
          checked={available}
          onChange={(event) => setAvailable(event.target.checked)}
        />
        Available in this workspace
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || name.trim() === ''}>
          {entry === undefined ? 'Create skill' : 'Save'}
        </Button>
        {entry !== undefined && onArchive !== undefined ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive"
            disabled={busy}
            onClick={onArchive}
          >
            Archive
          </Button>
        ) : null}
      </div>
    </form>
  )
}
