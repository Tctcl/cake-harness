import { useState } from 'react'

import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import { archiveWorkspace, updateWorkspace } from '../../lib/chat-api.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Textarea } from '../ui/textarea.tsx'

/**
 * What a workspace is, by name and description, plus the switch that decides how far its skills and providers reach.
 * General keeps its name and explains why its reach and archive controls cannot act.
 */
export function WorkspaceOverview({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceSummary
  onChanged: () => void
}) {
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [guard, setGuard] = useState<'reach' | 'archive' | null>(null)

  const changed = name.trim() !== workspace.name || description !== workspace.description

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      setError(null)
      onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the workspace could not be changed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-prose flex-col gap-6 text-sm">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = name.trim()
          if (trimmed === '') return

          void run(() => updateWorkspace(workspace.id, { name: trimmed, description }))
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="workspace-name" className="font-medium">
            Name
          </label>
          <Input
            id="workspace-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={workspace.isDefault}
          />
          {workspace.isDefault ? (
            <span className="text-xs text-muted-foreground">The default workspace keeps its name.</span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="workspace-description" className="font-medium">
            Description
          </label>
          <Textarea
            id="workspace-description"
            rows={2}
            placeholder="What this workspace is for…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <Button type="submit" size="sm" className="w-fit" disabled={busy || !changed || name.trim() === ''}>
          Save
        </Button>
      </form>

      <div className="flex flex-col gap-2 rounded-md border p-4">
        <div className="flex items-start gap-3">
          <input
            id="workspace-allow-all"
            type="checkbox"
            className={`mt-0.5 size-4 shrink-0 accent-foreground ${workspace.isDefault ? 'opacity-50' : ''}`}
            checked={workspace.allowAll}
            aria-disabled={workspace.isDefault ? 'true' : undefined}
            disabled={!workspace.isDefault && busy}
            onChange={(event) => {
              if (workspace.isDefault) {
                event.preventDefault()
                setGuard('reach')
                return
              }
              void run(() => updateWorkspace(workspace.id, { allowAll: event.target.checked }))
            }}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="workspace-allow-all" className="font-medium">
              Reach every capability
            </label>
            <span className="text-muted-foreground">
              A workspace narrows the skills, MCP servers and models its agents may use; this drops the narrowing
              entirely, including for anything added later. Each agent chooses its own tools.
            </span>
          </div>
        </div>
        {guard === 'reach' ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-muted-foreground">
            <span>General always reaches everything it can use; this cannot be changed.</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setGuard(null)}>Dismiss</Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-4">
        <span className="font-medium">Archive</span>
        <span className="text-muted-foreground">
          Archiving hides the workspace and its conversations from every list without deleting either.
        </span>
        <Button
          size="sm"
          variant="outline"
          className={`w-fit ${workspace.isDefault ? 'opacity-50' : ''}`}
          aria-disabled={workspace.isDefault ? 'true' : undefined}
          disabled={!workspace.isDefault && busy}
          onClick={() => {
            if (workspace.isDefault) {
              setGuard('archive')
              return
            }
            void run(() => archiveWorkspace(workspace.id))
          }}
        >
          Archive workspace
        </Button>
        {guard === 'archive' ? (
          <div role="alert" className="flex items-center justify-between gap-3 text-muted-foreground">
            <span>General is the default workspace and cannot be archived.</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setGuard(null)}>Dismiss</Button>
          </div>
        ) : null}
      </div>

      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
