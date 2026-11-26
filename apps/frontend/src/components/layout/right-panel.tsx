import type { ChatThread, WorkspaceSummary } from '../../lib/chat-api.ts'
import { DelegationsPanel } from '../chat/delegations-panel.tsx'
import { ProviderUsagePanel } from './provider-usage.tsx'
import { ScrollArea } from '../ui/scroll-area.tsx'
import { TerminalPanel } from './terminal-panel.tsx'
import { ThreadInfoSidebar } from './thread-info.tsx'
import type { PanelKind } from './topbar.tsx'

type RightPanelProps = {
  kind: PanelKind
  width: number
  thread: ChatThread | null
  workspace: WorkspaceSummary | null
  terminalWorkspaceId: string | null
}

/**
 * The right column, whose content the topbar chooses. It is only mounted while something is shown, so closing it
 * gives the chat the whole width rather than leaving a rail behind.
 */
function RightPanel({ kind, width, thread, workspace, terminalWorkspaceId }: RightPanelProps) {
  return (
    <aside
      className="flex shrink-0 flex-col border-l bg-background text-foreground"
      style={{ width }}
      aria-label={
        kind === 'info'
          ? 'Conversation info'
          : kind === 'subagents'
            ? 'Sub agents'
            : kind === 'terminal'
              ? 'Terminal'
              : 'Provider usage'
      }
    >
      {kind === 'info' ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col p-3">
            <ThreadInfoSidebar thread={thread} workspace={workspace} />
          </div>
        </ScrollArea>
      ) : kind === 'subagents' ? (
        <DelegationsPanel thread={thread} workspace={workspace} />
      ) : kind === 'usage' ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col p-3">
            {workspace === null ? (
              <p className="text-xs text-muted-foreground">Open a conversation to see what its workspace spends.</p>
            ) : (
              <ProviderUsagePanel workspaceId={workspace.id} />
            )}
          </div>
        </ScrollArea>
      ) : terminalWorkspaceId === null ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Open a conversation or a workspace’s Environment tab to use its terminal.
        </p>
      ) : (
        <TerminalPanel workspaceId={terminalWorkspaceId} />
      )}
    </aside>
  )
}

export { RightPanel }
