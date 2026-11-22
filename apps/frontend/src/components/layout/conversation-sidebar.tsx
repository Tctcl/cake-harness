import { PlusIcon } from 'lucide-react'

import type { ChatThread } from '../../lib/chat-api.ts'
import { Button } from '../ui/button.tsx'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty.tsx'
import { Separator } from '../ui/separator.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx'

type ConversationSidebarProps = {
  threads: ChatThread[]
  selectedId: string | null
  loading: boolean
  onCreate: () => void
  onSelect: (id: string) => void
}

/** The conversations of the selected workspace; the list is the navigation, so each row is a button. */
function ConversationSidebar({
  threads,
  selectedId,
  loading,
  onCreate,
  onSelect,
}: ConversationSidebarProps) {
  return (
    <>
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-xs text-muted-foreground">Conversations</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="New conversation"
              onClick={onCreate}
            >
              <PlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Start a conversation in this workspace</TooltipContent>
        </Tooltip>
      </div>

      <Separator className="mb-2" />

      {loading ? <p className="px-2 text-xs text-muted-foreground">Loading…</p> : null}
      {!loading && threads.length === 0 ? (
        <Empty className="p-2">
          <EmptyHeader>
            <EmptyTitle className="text-sm">No conversations in this workspace yet.</EmptyTitle>
            <EmptyDescription className="text-xs">
              Press + to start one; the agent runs in this workspace.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {threads.length === 0 ? null : (
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
            All conversations ({threads.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-1 flex flex-col gap-0.5">
              {threads.map((thread) => {
                const title = thread.title ?? 'Untitled conversation'

                return (
                  <li key={thread.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-current={thread.id === selectedId ? 'true' : undefined}
                          className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=true]:bg-sidebar-accent aria-[current=true]:text-sidebar-accent-foreground"
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
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  )
}

export { ConversationSidebar }
