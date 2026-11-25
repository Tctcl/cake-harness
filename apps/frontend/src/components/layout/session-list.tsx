import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import { useState, type DragEvent } from 'react'

import type { ChatThread, WorkspaceSummary } from '../../lib/chat-api.ts'
import { Button } from '../ui/button.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx'

type SessionListProps = {
  workspaces: WorkspaceSummary[]
  threads: ChatThread[]
  selectedId: string | null
  loading: boolean
  collapsed: ReadonlySet<string>
  onToggle: (workspaceId: string) => void
  onCreate: (workspaceId: string) => void
  onSelect: (threadId: string) => void
  onReorder: (ids: string[]) => void
}

/** Where the dragged workspace lands: the target's own index, or the one after it. */
function moveInto(ids: readonly string[], movedId: string, targetId: string, after: boolean): string[] {
  const without = ids.filter((id) => id !== movedId)
  const target = without.indexOf(targetId)
  if (target === -1) return [...ids]

  const at = after ? target + 1 : target

  return [...without.slice(0, at), movedId, ...without.slice(at)]
}

/**
 * Every conversation, grouped under the workspace it belongs to. The workspace is a heading, not a filter: it folds to
 * hide its sessions and carries the + that starts a new one there. The list order is the user's — dragging a heading
 * rewrites it, and the backend is the record, so the arrangement survives the browser.
 */
function SessionList({
  workspaces,
  threads,
  selectedId,
  loading,
  collapsed,
  onToggle,
  onCreate,
  onSelect,
  onReorder,
}: SessionListProps) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null)

  const order = workspaces.map((workspace) => workspace.id)

  function handleDragOver(event: DragEvent<HTMLDivElement>, workspaceId: string) {
    if (dragging === null || dragging === workspaceId) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const box = event.currentTarget.getBoundingClientRect()
    const after = event.clientY > box.top + box.height / 2
    setDropAt((current) =>
      current?.id === workspaceId && current.after === after ? current : { id: workspaceId, after },
    )
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, workspaceId: string) {
    event.preventDefault()
    const moved = dragging
    const after = dropAt?.id === workspaceId ? dropAt.after : false
    setDragging(null)
    setDropAt(null)
    if (moved === null || moved === workspaceId) return

    const next = moveInto(order, moved, workspaceId, after)
    if (next.some((id, index) => id !== order[index])) onReorder(next)
  }

  return (
    <>
      {loading ? <p className="px-2 pb-2 text-xs text-muted-foreground">Loading…</p> : null}
      {!loading && workspaces.length === 0 ? (
        <Empty className="p-2">
          <EmptyHeader>
            <EmptyTitle className="text-sm">No workspaces yet.</EmptyTitle>
            <EmptyDescription className="text-xs">
              Add one in the workspace manager; every conversation lives in a workspace.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      <ul className="flex flex-col gap-1">
        {workspaces.map((workspace) => {
          const sessions = threads.filter((thread) => thread.workspaceId === workspace.id)
          const folded = collapsed.has(workspace.id)
          const listId = `sessions-of-${workspace.id}`
          const mark = dropAt?.id === workspace.id ? (dropAt.after ? 'border-b' : 'border-t') : null

          return (
            <li key={workspace.id} className="flex flex-col">
              <div
                draggable
                className={`flex items-center gap-1 rounded-md ${mark ?? 'border-y border-transparent'} ${
                  dragging === workspace.id ? 'opacity-50' : ''
                }`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  // Some browsers cancel a drag that sets no payload at all.
                  event.dataTransfer.setData('text/plain', workspace.id)
                  setDragging(workspace.id)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setDropAt(null)
                }}
                onDragOver={(event) => handleDragOver(event, workspace.id)}
                onDrop={(event) => handleDrop(event, workspace.id)}
              >
                <button
                  type="button"
                  aria-expanded={!folded}
                  aria-controls={listId}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  onClick={() => onToggle(workspace.id)}
                >
                  {folded ? (
                    <ChevronRightIcon className="size-3 shrink-0" />
                  ) : (
                    <ChevronDownIcon className="size-3 shrink-0" />
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate">{workspace.name}</span>
                    </TooltipTrigger>
                    <TooltipContent side="right">{workspace.name}</TooltipContent>
                  </Tooltip>
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      aria-label={`New conversation in ${workspace.name}`}
                      onClick={() => onCreate(workspace.id)}
                    >
                      <PlusIcon className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Start a conversation in {workspace.name}</TooltipContent>
                </Tooltip>
              </div>

              {folded ? null : (
                <ul id={listId} className="mt-0.5 flex flex-col gap-0.5">
                  {sessions.length === 0 ? (
                    <li className="px-2 py-1 text-xs text-muted-foreground/70">No conversations yet</li>
                  ) : null}
                  {sessions.map((thread) => {
                    const title = thread.title ?? 'Untitled conversation'

                    return (
                      <li key={thread.id}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-current={thread.id === selectedId ? 'true' : undefined}
                              className="w-full truncate rounded-md px-2 py-1.5 pl-5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=true]:bg-sidebar-accent aria-[current=true]:text-sidebar-accent-foreground"
                              onClick={() => onSelect(thread.id)}
                            >
                              {title}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right">{title}</TooltipContent>
                        </Tooltip>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

export { SessionList }
