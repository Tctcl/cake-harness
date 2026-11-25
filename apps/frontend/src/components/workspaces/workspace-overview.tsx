import { useState } from 'react'

import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import { archiveWorkspace, updateWorkspace } from '../../lib/chat-api.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Textarea } from '../ui/textarea.tsx'

/**
 * What a workspace is, by name and description, plus the two switches that decide how far it reaches: everything, or the
 * selection made on the Skills, Prompts, Tools and MCP tabs. The default workspace cannot be renamed or archived.
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
            className="mt-0.5 size-4 shrink-0 accent-foreground"
            checked={workspace.allowAll}
            disabled={busy}
            onChange={(event) => void run(() => updateWorkspace(workspace.id, { allowAll: event.target.checked }))}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="workspace-allow-all" className="font-medium">
              Reach every capability
            </label>
            <span className="text-muted-foreground">
              A workspace narrows what its agents may use; this drops the narrowing entirely, including for anything added
              later. Leave it off to pick tools, skills, prompts, MCP servers and models on their own tabs.
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-4">
        <span className="font-medium">Archive</span>
        <span className="text-muted-foreground">
          Archiving hides the workspace and its conversations from every list without deleting either. The default
          workspace cannot be archived.
        </span>
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={busy || workspace.isDefault}
          onClick={() => void run(() => archiveWorkspace(workspace.id))}
        >
          Archive workspace
        </Button>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
