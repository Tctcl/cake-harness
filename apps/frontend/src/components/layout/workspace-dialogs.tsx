import { useState } from 'react'

import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import { archiveWorkspace, createWorkspace, renameWorkspace } from '../../lib/chat-api.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.tsx'
import { Input } from '../ui/input.tsx'
import { Label } from '../ui/label.tsx'
import { Separator } from '../ui/separator.tsx'

type CreateWorkspaceDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (workspace: WorkspaceSummary) => void
}

/** A new workspace: name and description now, tooling and containers later. */
export function CreateWorkspaceDialog({ open, onOpenChange, onCreated }: CreateWorkspaceDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()

  async function submit() {
    if (trimmed === '' || busy) return

    setBusy(true)
    try {
      const created = await createWorkspace(trimmed, description.trim())
      onCreated(created)
      setName('')
      setDescription('')
      setError(null)
      onOpenChange(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the workspace could not be created')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            A workspace groups conversations and caps the tools, MCP servers and skills its agents may use.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Platform services"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="workspace-description">Description</Label>
            <Input
              id="workspace-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this workspace is for"
            />
          </div>

          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed === '' || busy}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type ManageWorkspacesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaces: WorkspaceSummary[]
  onChanged: () => void
}

/** Renaming and archiving. The default workspace is the one every session can fall back on, so it is not editable. */
export function ManageWorkspacesDialog({
  open,
  onOpenChange,
  workspaces,
  onChanged,
}: ManageWorkspacesDialogProps) {
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      setError(null)
      onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the workspace could not be changed')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage workspaces</DialogTitle>
          <DialogDescription>
            Rename or archive a workspace. Archiving keeps its conversations, but hides it from the picker.
          </DialogDescription>
        </DialogHeader>

        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <ul className="flex flex-col gap-1">
          {workspaces.map((workspace) => {
            const editing = draft?.id === workspace.id

            return (
              <li key={workspace.id} className="flex flex-col gap-1 rounded-md p-2 hover:bg-muted/50">
                {editing ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const name = draft.name.trim()
                      if (name === '') return

                      void run(() => renameWorkspace(workspace.id, name)).then(() => setDraft(null))
                    }}
                  >
                    <Input
                      aria-label={`Rename ${workspace.name}`}
                      value={draft.name}
                      onChange={(event) => setDraft({ id: workspace.id, name: event.target.value })}
                    />
                    <Button type="submit" size="sm">
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{workspace.name}</span>
                    {workspace.isDefault ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        Default
                      </Badge>
                    ) : null}
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={workspace.isDefault}
                        onClick={() => setDraft({ id: workspace.id, name: workspace.name })}
                      >
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={workspace.isDefault}
                        onClick={() => void run(() => archiveWorkspace(workspace.id))}
                      >
                        Archive
                      </Button>
                    </span>
                  </div>
                )}
                {workspace.description === '' ? null : (
                  <span className="truncate text-xs text-muted-foreground">{workspace.description}</span>
                )}
              </li>
            )
          })}
        </ul>

        <Separator />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
