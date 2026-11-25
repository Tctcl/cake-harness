import { ArrowLeftIcon, FolderPlusIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import { createWorkspace, listWorkspaces } from '../../lib/chat-api.ts'
import { Button } from '../ui/button.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty.tsx'
import { Input } from '../ui/input.tsx'
import { Spinner } from '../ui/spinner.tsx'
import { WorkspaceDetail } from './workspace-detail.tsx'
import type { WorkspaceTabId } from './workspace-detail.tsx'
import { useNarrowScreen } from '../../lib/use-narrow-screen.ts'

/**
 * Workspace management, a window of its own rather than a settings section: the list on the left is every workspace, the
 * right is the one selected out of it, and only that one is loaded. The window's chrome — its title and the way out —
 * belongs to the overlay around it. The sidebar's order is arranged by dragging there, so nothing here mentions it.
 */
export function WorkspacesPage({
  onOpenCredentials,
  initialWorkspaceId = null,
  initialTab = 'overview',
}: {
  onOpenCredentials: () => void
  /** The workspace to open on, and its tab; another screen uses this to send the user to a specific fix. */
  initialWorkspaceId?: string | null
  initialTab?: WorkspaceTabId
}) {
  const narrow = useNarrowScreen()
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(initialWorkspaceId)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Where an empty submit sends the focus: the button is never disabled, so a click that does nothing would look broken.
  const nameInput = useRef<HTMLInputElement>(null)
  // Every change here is a change to the list, so the server's copy of it is read again rather than patched in place.
  const [nonce, setNonce] = useState(0)

  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? null
  const reload = (): void => setNonce((value) => value + 1)

  useEffect(() => {
    let cancelled = false
    void listWorkspaces().then(
      (loaded) => {
        if (cancelled) return
        setWorkspaces(loaded)
        setLoading(false)
      },
      (failure: unknown) => {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : 'workspaces failed to load')
        setLoading(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [nonce])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('Name the workspace first')
      nameInput.current?.focus()
      return
    }

    setBusy(true)
    try {
      const created = await createWorkspace(trimmed, '')
      setName('')
      setError(null)
      setSelectedId(created.id)
      reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the workspace could not be added')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* A phone shows the list or one workspace, never both side by side. */}
      <nav
        aria-label="Workspaces"
        className={`${narrow && selected !== null ? 'hidden' : 'flex'} w-full shrink-0 flex-col gap-1 bg-sidebar p-2 text-sidebar-foreground md:w-64 md:border-r`}
      >
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {loading && workspaces.length === 0 ? (
            <li className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
              <Spinner /> Loading workspaces…
            </li>
          ) : null}
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <button
                type="button"
                aria-current={workspace.id === selectedId ? 'true' : undefined}
                onClick={() => setSelectedId(workspace.id)}
                className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                  workspace.id === selectedId ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''
                }`}
              >
                <span className="w-full truncate font-medium">{workspace.name}</span>
                {workspace.description === '' ? null : (
                  <span className="w-full truncate text-xs text-muted-foreground">{workspace.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <form className="flex flex-col gap-2 border-t pt-2" onSubmit={(event) => void add(event)}>
          <Input
            ref={nameInput}
            aria-label="New workspace name"
            placeholder="New workspace…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            <FolderPlusIcon className="size-4" aria-hidden />
            Add workspace
          </Button>
          {error === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      </nav>

      <main className={`${narrow && selected === null ? 'hidden' : ''} min-w-0 flex-1 overflow-y-auto`}>
        {selected === null ? (
          <div className="flex h-full items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderPlusIcon />
                </EmptyMedia>
                <EmptyTitle>No workspace selected</EmptyTitle>
                <EmptyDescription>
                  Pick a workspace on the left to set up its container, its MCP servers, what it may use and which models
                  it reaches — or add one.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <>
            {narrow ? (
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-2 px-4 pt-3 text-sm text-muted-foreground"
              >
                <ArrowLeftIcon className="size-4" aria-hidden />
                Workspaces
              </button>
            ) : null}
            {/* Keyed on the id: switching workspace starts the next one on its first tab, not on the last one's. */}
            <WorkspaceDetail
              key={selected.id}
              workspace={selected}
              onChanged={reload}
              onOpenCredentials={onOpenCredentials}
              initialTab={selected.id === initialWorkspaceId ? initialTab : 'overview'}
            />
          </>
        )}
      </main>
    </div>
  )
}
