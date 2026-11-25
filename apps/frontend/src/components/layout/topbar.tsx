import { ChartColumnIcon, ListIcon, PencilIcon, TerminalIcon } from 'lucide-react'
import { useState } from 'react'

import type { ChatThread } from '../../lib/chat-api.ts'
import { renameThread } from '../../lib/chat-api.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx'

/** Which content the right column is showing; `null` means nothing is shown and the column is gone. */
type PanelKind = 'info' | 'terminal' | 'usage'

type TopbarProps = {
  thread: ChatThread | null
  panel: PanelKind | null
  onToggle: (panel: PanelKind) => void
  onRenamed: (thread: ChatThread) => void
}

/**
 * The strip above the chat and the panel it can show. The open conversation's name lives here rather than in the
 * panel, so the panel can be closed without losing the context of what is open, and the two toggles choose what the
 * panel holds.
 */
function Topbar({ thread, panel, onToggle, onRenamed }: TopbarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const editing = thread !== null && editingId === thread.id
  const title = thread?.title ?? 'Untitled conversation'

  function save() {
    if (thread === null) return

    const next = draft.trim()
    setEditingId(null)
    void renameThread(thread.id, next === '' ? null : next).then(onRenamed, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : 'the title could not be saved')
    })
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      {thread === null ? (
        <span className="truncate text-sm text-muted-foreground">No conversation selected</span>
      ) : editing ? (
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <Input
            aria-label="Conversation title"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditingId(null)
            }}
          />
        </form>
      ) : (
        <button
          type="button"
          className="group flex min-w-0 items-center gap-1 text-left"
          aria-label="Rename conversation"
          onClick={() => {
            setDraft(thread.title ?? '')
            setEditingId(thread.id)
          }}
        >
          <span className="truncate text-sm font-medium">{title}</span>
          <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
      )}

      {error === null ? null : (
        <p role="alert" className="truncate text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Conversation info"
              aria-pressed={panel === 'info'}
              onClick={() => onToggle('info')}
            >
              <ListIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Environment, context and SSH</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Terminal"
              aria-pressed={panel === 'terminal'}
              onClick={() => onToggle('terminal')}
            >
              <TerminalIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Terminal sessions</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Provider usage"
              aria-pressed={panel === 'usage'}
              onClick={() => onToggle('usage')}
            >
              <ChartColumnIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">What the workspace's providers have cost</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

export { Topbar }
export type { PanelKind }
