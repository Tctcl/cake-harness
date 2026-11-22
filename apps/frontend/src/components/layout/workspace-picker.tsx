import { ChevronsUpDownIcon, PlusIcon, SettingsIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import { Button } from '../ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { Separator } from '../ui/separator.tsx'

type WorkspacePickerProps = {
  workspaces: WorkspaceSummary[]
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onManage: () => void
}

const matches = (workspace: WorkspaceSummary, query: string) => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true

  return (
    `${workspace.name} ${workspace.description}`.toLowerCase().includes(needle)
  )
}

/**
 * The workspace the conversations belong to, at the foot of the left sidebar. Opening it focuses the filter, so the
 * workspace can be found by typing and taken with Enter; the default workspace is always in the list and never renamed
 * from here, which is what the manage dialog is for.
 */
export function WorkspacePicker({
  workspaces,
  selectedId,
  loading,
  onSelect,
  onCreate,
  onManage,
}: WorkspacePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = workspaces.find((workspace) => workspace.id === selectedId)
  const visible = useMemo(
    () => workspaces.filter((workspace) => matches(workspace, query)),
    [workspaces, query],
  )

  function choose(id: string) {
    onSelect(id)
    setOpen(false)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return

    // Every opening starts from the whole list: a stale filter would hide the workspace just picked.
    setQuery('')
    setHighlighted(0)
  }

  // The filter takes the caret as the selector opens, so the workspace can be reached by typing alone.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Workspace"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">
              {selected?.name ?? (loading ? 'Loading…' : 'No workspace')}
            </span>
            <span className="truncate text-xs text-muted-foreground">Workspace</span>
          </span>
          <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent side="top" align="start" className="w-(--radix-popover-trigger-width) min-w-64 p-0">
        <div className="p-2">
          <input
            ref={inputRef}
            aria-label="Find a workspace"
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            placeholder="Find a workspace…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlighted((current) => Math.min(visible.length - 1, current + 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlighted((current) => Math.max(0, current - 1))
              }
              if (event.key !== 'Enter') return

              event.preventDefault()
              const pick = visible[highlighted] ?? visible[0]
              if (pick !== undefined) choose(pick.id)
            }}
          />
        </div>

        {visible.length === 0 ? (
          <p className="px-3 pb-2 text-xs text-muted-foreground">No workspace matches.</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto px-1 pb-1" aria-label="Workspaces">
            {visible.map((workspace, index) => (
              <li key={workspace.id}>
                <button
                  type="button"
                  aria-current={workspace.id === selectedId ? 'true' : undefined}
                  className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground aria-[selected=true]:bg-accent aria-[selected=true]:text-accent-foreground data-[highlighted=true]:bg-accent data-[highlighted=true]:text-accent-foreground"
                  data-highlighted={index === highlighted}
                  onPointerEnter={() => setHighlighted(index)}
                  onClick={() => choose(workspace.id)}
                >
                  <span className="truncate">{workspace.name}</span>
                  {workspace.description === '' ? null : (
                    <span className="truncate text-xs text-muted-foreground">{workspace.description}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <Separator />

        <div className="flex items-center gap-1 p-1">
          <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={onManage}>
            <SettingsIcon />
            Manage
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={onCreate}>
            <PlusIcon />
            Add
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
