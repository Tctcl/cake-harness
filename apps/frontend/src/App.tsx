import { useCallback, useEffect, useState } from 'react'

import { ChatPane } from './components/chat/chat-pane.tsx'
import { RightPanel } from './components/layout/right-panel.tsx'
import { SessionList } from './components/layout/session-list.tsx'
import { ResizeHandle, Sidebar, SidebarRail, type SidebarWidths } from './components/layout/sidebar.tsx'
import { ThemePicker } from './components/layout/theme-picker.tsx'
import { Topbar, type PanelKind } from './components/layout/topbar.tsx'
import { UpdateNotice } from './components/layout/update-notice.tsx'
import { UserMenu } from './components/layout/user-menu.tsx'
import { SettingsPage } from './components/settings/settings-page.tsx'
import { WorkspacesPage } from './components/workspaces/workspaces-page.tsx'
import { TooltipProvider } from './components/ui/tooltip.tsx'
import type { ChatThread, CurrentUser, WorkspaceSummary } from './lib/chat-api.ts'
import { createThread, getMe, listThreads, listWorkspaces, reorderWorkspaces } from './lib/chat-api.ts'
import { readCollapsed, writeCollapsed } from './lib/workspace-groups.ts'

/**
 * Every sidebar's resize range and the width it opens at. The conversation list is a column of names and stays narrow;
 * the terminal holds a grid of characters and opens wider than the panel that only reports.
 */
const SIDEBAR_WIDTHS = {
  threads: { min: 200, max: 420, open: 260 },
  info: { min: 240, max: 420, open: 280 },
  terminal: { min: 320, max: 640, open: 460 },
  usage: { min: 240, max: 460, open: 300 },
} satisfies Record<string, SidebarWidths>

/**
 * Every conversation on the left, grouped under its workspace and arranged by dragging, a topbar over the chat, and a
 * right column the topbar fills with either the open conversation's surroundings or a terminal — and closes again,
 * giving the chat the whole width. Switching conversations or workspaces never closes a run: the stream belongs to the
 * thread store, not to the pane that happens to be mounted.
 *
 * Settings and the workspace manager are screens, not panes: each replaces the three columns wholesale and comes back to
 * them unchanged. What belongs to a workspace is edited inside the workspace manager, so settings holds only the app and
 * the user.
 */
function App({ onSignOut }: { onSignOut?: (() => void) | undefined } = {}) {
  const [view, setView] = useState<'chat' | 'settings' | 'workspaces'>('chat')
  const [me, setMe] = useState<CurrentUser | null>(null)
  const [loadingMe, setLoadingMe] = useState(true)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true)
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Folded groups are how the list is read, not what it holds: they stay in this browser while the order is the server's.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readCollapsed())

  const [leftWidth, setLeftWidth] = useState(SIDEBAR_WIDTHS.threads.open)
  // Each right panel keeps the width it was dragged to: switching between them is not a reason to forget one.
  const [rightWidths, setRightWidths] = useState<Record<PanelKind, number>>({
    info: SIDEBAR_WIDTHS.info.open,
    terminal: SIDEBAR_WIDTHS.terminal.open,
    usage: SIDEBAR_WIDTHS.usage.open,
  })
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  // Nothing shown is the default: the right column is a place with content, not a fixture of the layout.
  const [rightPanel, setRightPanel] = useState<PanelKind | null>(null)

  const loadWorkspaces = useCallback(() => {
    void listWorkspaces().then(
      (loaded) => {
        setWorkspaces(loaded)
        setLoadingWorkspaces(false)
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'workspaces failed to load')
        setLoadingWorkspaces(false)
      },
    )
  }, [])

  // One request for every conversation of every workspace: the list groups them itself, and the backend answers the
  // whole set when no workspace is named.
  const loadThreads = useCallback(() => {
    void listThreads(null).then(
      (loaded) => {
        setThreads(loaded)
        setLoadingThreads(false)
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'conversations failed to load')
        setLoadingThreads(false)
      },
    )
  }, [])

  useEffect(() => {
    loadWorkspaces()
    loadThreads()
  }, [loadWorkspaces, loadThreads])

  useEffect(() => {
    writeCollapsed(
      collapsed,
      workspaces.map((workspace) => workspace.id),
    )
  }, [collapsed, workspaces])

  useEffect(() => {
    let cancelled = false

    void getMe().then(
      (loaded) => {
        if (cancelled) return
        setMe(loaded)
        setLoadingMe(false)
      },
      () => {
        if (cancelled) return
        setLoadingMe(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  async function startThread(workspaceId: string) {
    try {
      const created = await createThread(workspaceId)
      setThreads((current) => [created, ...current])
      setThreadId(created.id)
      // The + that started it may have been in a folded group; opening it is how the new conversation is reachable.
      setCollapsed((current) => {
        if (!current.has(workspaceId)) return current
        const next = new Set(current)
        next.delete(workspaceId)

        return next
      })
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the conversation failed to start')
    }
  }

  function toggleWorkspace(workspaceId: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(workspaceId)) next.add(workspaceId)

      return next
    })
  }

  /**
   * The new order shows first and is put back if the server refuses it: dragging has to feel immediate, but the stored
   * order is the one that survives a reload, so a failed write cannot be left looking applied.
   */
  async function reorder(ids: string[]) {
    const previous = workspaces
    const byId = new Map(previous.map((workspace) => [workspace.id, workspace]))
    setWorkspaces(
      ids.flatMap((id, position) => {
        const workspace = byId.get(id)

        return workspace === undefined ? [] : [{ ...workspace, position }]
      }),
    )

    try {
      setWorkspaces(await reorderWorkspaces(ids))
      setError(null)
    } catch (failure) {
      setWorkspaces(previous)
      setError(failure instanceof Error ? failure.message : 'the new order was not saved')
    }
  }

  const selectedThread = threads.find((thread) => thread.id === threadId) ?? null
  // The conversation names its workspace; there is no separate workspace selection to fall out of step with it.
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedThread?.workspaceId) ?? null
  const leftSpace = leftCollapsed ? 0 : leftWidth
  const rightBounds = rightPanel === null ? SIDEBAR_WIDTHS.info : SIDEBAR_WIDTHS[rightPanel]
  const rightWidth = rightPanel === null ? 0 : rightWidths[rightPanel]

  if (view === 'workspaces') {
    return (
      <TooltipProvider>
        <div className="h-full min-h-0">
          <WorkspacesPage
            onClose={() => {
              // Workspaces are added and archived there, so the list is re-read before the columns come back.
              loadWorkspaces()
              loadThreads()
              setView('chat')
            }}
          />
        </div>
      </TooltipProvider>
    )
  }

  if (view === 'settings') {
    return (
      <TooltipProvider>
        <div className="h-full min-h-0">
          <SettingsPage
            user={me}
            onClose={() => {
              setView('chat')
            }}
          />
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 overflow-hidden">
        {leftCollapsed ? (
          <SidebarRail side="left" title="Conversations" onExpand={() => setLeftCollapsed(false)} />
        ) : (
          <>
            <Sidebar
              side="left"
              title="Conversations"
              widths={SIDEBAR_WIDTHS.threads}
              width={leftWidth}
              otherWidth={rightWidth}
              onWidthChange={setLeftWidth}
              onCollapse={() => setLeftCollapsed(true)}
              action={<ThemePicker />}
              footer={
                <div className="flex flex-col gap-2">
                  <UpdateNotice />
                  <UserMenu
                    user={me}
                    loading={loadingMe}
                    onOpenSettings={() => setView('settings')}
                    onOpenWorkspaces={() => setView('workspaces')}
                    onSignOut={onSignOut}
                  />
                </div>
              }
            >
              <SessionList
                workspaces={workspaces}
                threads={threads}
                selectedId={threadId}
                loading={loadingWorkspaces || loadingThreads}
                collapsed={collapsed}
                onToggle={toggleWorkspace}
                onCreate={(workspaceId) => void startThread(workspaceId)}
                onSelect={setThreadId}
                onReorder={(ids) => void reorder(ids)}
              />
            </Sidebar>
            <ResizeHandle
              side="left"
              widths={SIDEBAR_WIDTHS.threads}
              width={leftWidth}
              otherWidth={rightWidth}
              onWidthChange={setLeftWidth}
              onCollapse={() => setLeftCollapsed(true)}
            />
          </>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar
            thread={selectedThread}
            panel={rightPanel}
            onToggle={(next) => setRightPanel((current) => (current === next ? null : next))}
            onRenamed={(renamed) =>
              setThreads((current) =>
                current.map((thread) => (thread.id === renamed.id ? renamed : thread)),
              )
            }
          />

          <div className="flex min-h-0 flex-1">
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {error === null ? null : (
                <p role="alert" className="px-4 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="min-h-0 flex-1">
                <ChatPane threadId={threadId} />
              </div>
            </main>

            {rightPanel === null ? null : (
              <>
                <ResizeHandle
                  side="right"
                  widths={rightBounds}
                  width={rightWidth}
                  otherWidth={leftSpace}
                  onWidthChange={(width) => {
                    if (rightPanel === null) return
                    setRightWidths((current) => ({ ...current, [rightPanel]: width }))
                  }}
                  onCollapse={() => setRightPanel(null)}
                />
                <RightPanel
                  kind={rightPanel}
                  width={rightWidth}
                  thread={selectedThread}
                  workspace={selectedWorkspace}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default App
