import { useCallback, useEffect, useState } from 'react'

import { AgentPicker } from './components/chat/agent-picker.tsx'
import { ChatPane } from './components/chat/chat-pane.tsx'
import { RightPanel } from './components/layout/right-panel.tsx'
import { OverlayWindow } from './components/layout/overlay-window.tsx'
import { SessionList } from './components/layout/session-list.tsx'
import { ResizeHandle, Sidebar, SidebarRail, type SidebarWidths } from './components/layout/sidebar.tsx'
import { ThemePicker } from './components/layout/theme-picker.tsx'
import { Topbar, type PanelKind } from './components/layout/topbar.tsx'
import { UpdateNotice } from './components/layout/update-notice.tsx'
import { UserMenu } from './components/layout/user-menu.tsx'
import { SettingsPage } from './components/settings/settings-page.tsx'
import type { SectionId } from './components/settings/settings-page.tsx'
import { Button } from './components/ui/button.tsx'
import { TooltipProvider } from './components/ui/tooltip.tsx'
import type { WorkspaceTabId } from './components/workspaces/workspace-detail.tsx'
import { WorkspacesPage } from './components/workspaces/workspaces-page.tsx'
import type { ChatAgent, ChatThread, CurrentUser, WorkspaceSummary } from './lib/chat-api.ts'
import { createThread, getMe, listAgents, listThreads, listWorkspaces, reorderWorkspaces } from './lib/chat-api.ts'
import { KEY_PROBLEMS } from './lib/chat-store.ts'
import { HttpError } from './lib/http.ts'
import { useNarrowScreen } from './lib/use-narrow-screen.ts'
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

/** What the full-screen panel is called on a narrow screen, where the topbar icon that opened it is covered. */
const PANEL_TITLES: Record<PanelKind, string> = { info: 'Conversation info', terminal: 'Terminal', usage: 'Usage' }

/** A failure the shell shows above the chat, with the backend's code when there is one so it can offer the fix. */
interface Problem {
  readonly message: string
  readonly code: string | undefined
}

const problemOf = (failure: unknown, fallback: string): Problem => ({
  message: failure instanceof Error ? failure.message : fallback,
  code: failure instanceof HttpError ? failure.code : undefined,
})

/** Where the workspace manager opens: a workspace and one of its tabs, or its own list. */
interface WorkspacesTarget {
  readonly workspaceId: string | null
  readonly tab: WorkspaceTabId
}

/**
 * Every conversation on the left, grouped under its workspace and arranged by dragging, a topbar over the chat, and a
 * right column the topbar fills with either the open conversation's surroundings or a terminal — and closes again,
 * giving the chat the whole width. Switching conversations or workspaces never closes a run: the stream belongs to the
 * thread store, not to the pane that happens to be mounted.
 *
 * On a narrow screen there is no room for columns: the conversation list is a drawer the topbar opens, and the right
 * panel covers the chat until it is closed.
 *
 * Settings and the workspace manager are windows over the columns, not screens that replace them: the chat stays where it
 * was, dimmed behind them, and closing one comes back to it unchanged. What belongs to a workspace is edited inside the
 * workspace manager, so settings holds only the app and the user.
 */
function App({ onSignOut }: { onSignOut?: (() => void) | undefined } = {}) {
  const narrow = useNarrowScreen()
  const [view, setView] = useState<'chat' | 'settings' | 'workspaces'>('chat')
  const [settingsSection, setSettingsSection] = useState<SectionId>('application')
  const [workspacesTarget, setWorkspacesTarget] = useState<WorkspacesTarget>({ workspaceId: null, tab: 'overview' })
  const [me, setMe] = useState<CurrentUser | null>(null)
  const [loadingMe, setLoadingMe] = useState(true)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [threadId, setThreadId] = useState<string | null>(null)
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true)
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [error, setError] = useState<Problem | null>(null)
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
  // The narrow screen's drawer: closed by default, because the chat is what a phone shows first.
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Nothing shown is the default: the right column is a place with content, not a fixture of the layout.
  const [rightPanel, setRightPanel] = useState<PanelKind | null>(null)
  // Unlike the conversation-derived panels, a terminal can be opened for a workspace that has no selected thread.
  const [terminalWorkspaceId, setTerminalWorkspaceId] = useState<string | null>(null)
  // A new conversation in a workspace with several agents waits here for the user to pick one.
  const [picking, setPicking] = useState<{ readonly workspace: WorkspaceSummary; readonly agents: ChatAgent[] } | null>(
    null,
  )

  const loadWorkspaces = useCallback(() => {
    void listWorkspaces().then(
      (loaded) => {
        setWorkspaces(loaded)
        setLoadingWorkspaces(false)
      },
      (failure: unknown) => {
        setError(problemOf(failure, 'workspaces failed to load'))
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
        setError(problemOf(failure, 'conversations failed to load'))
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

  const selectedThread = threads.find((thread) => thread.id === threadId) ?? null
  // The conversation names its workspace; there is no separate workspace selection to fall out of step with it.
  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedThread?.workspaceId) ?? null

  const openWorkspaces = (target: WorkspacesTarget): void => {
    setWorkspacesTarget(target)
    setView('workspaces')
  }

  const openSettings = (section: SectionId): void => {
    setSettingsSection(section)
    setView('settings')
  }

  const openTerminal = (workspaceId: string): void => {
    setTerminalWorkspaceId(workspaceId)
    setRightPanel('terminal')
    setView('chat')
    setError(null)
    // Closing the workspace window by this route has the same refresh semantics as its Close button.
    loadWorkspaces()
    loadThreads()
  }

  const togglePanel = (next: PanelKind): void => {
    if (rightPanel === next) {
      setRightPanel(null)
      return
    }
    if (next === 'terminal') setTerminalWorkspaceId(selectedWorkspace?.id ?? null)
    setRightPanel(next)
  }

  /** The fix for a missing key or a disallowed model lives on the workspace's Providers tab. */
  const setUpKeys = (workspaceId: string | null): void => openWorkspaces({ workspaceId, tab: 'providers' })

  /** The "+" of a workspace: straight in when it has one agent, otherwise ask which one answers. */
  async function newConversation(workspaceId: string) {
    const workspace = workspaces.find((candidate) => candidate.id === workspaceId)
    try {
      const agents = await listAgents(workspaceId)
      if (agents.length > 1 && workspace !== undefined) {
        setPicking({ workspace, agents })
        setDrawerOpen(false)
        return
      }
    } catch (failure) {
      setError(problemOf(failure, 'the agents failed to load'))
      return
    }
    await startThread(workspaceId)
  }

  async function startThread(workspaceId: string, agentId?: string) {
    setPicking(null)
    try {
      const created = await createThread(workspaceId, agentId)
      setThreads((current) => [created, ...current])
      setThreadId(created.id)
      setTerminalWorkspaceId(created.workspaceId)
      setDrawerOpen(false)
      // The + that started it may have been in a folded group; opening it is how the new conversation is reachable.
      setCollapsed((current) => {
        if (!current.has(workspaceId)) return current
        const next = new Set(current)
        next.delete(workspaceId)

        return next
      })
      setError(null)
    } catch (failure) {
      setError(problemOf(failure, 'the conversation failed to start'))
      // Remembered so the banner's fix opens the workspace whose agent could not start.
      setWorkspacesTarget({ workspaceId, tab: 'providers' })
      setDrawerOpen(false)
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
      setError(problemOf(failure, 'the new order was not saved'))
    }
  }

  // The window sits over the chat rather than in its place: the columns underneath keep their state while it is open.
  const overlay =
    view === 'chat' ? null : (
      <OverlayWindow
        // Keyed on the view so opening the other window starts it fresh instead of growing out of this one.
        key={view}
        title={view === 'settings' ? 'Settings' : 'Workspaces'}
        onClose={() => {
          if (view === 'workspaces') {
            // Workspaces, agents and keys change there, so the lists are re-read before the chat comes back.
            loadWorkspaces()
            loadThreads()
          }
          setError(null)
          setView('chat')
        }}
      >
        {view === 'settings' ? (
          <SettingsPage initialSection={settingsSection} />
        ) : (
          <WorkspacesPage
            initialWorkspaceId={workspacesTarget.workspaceId}
            initialTab={workspacesTarget.tab}
            onOpenCredentials={() => openSettings('credentials')}
            onOpenSshKeys={() => openSettings('ssh-keys')}
            onOpenTerminal={openTerminal}
          />
        )}
      </OverlayWindow>
    )

  const sidebarFooter = (
    <div className="flex flex-col gap-2">
      <UpdateNotice />
      <UserMenu
        user={me}
        loading={loadingMe}
        onOpenSettings={() => openSettings('application')}
        onOpenWorkspaces={() => openWorkspaces({ workspaceId: null, tab: 'overview' })}
        onSignOut={onSignOut}
      />
    </div>
  )

  const sessionList = (
    <SessionList
      workspaces={workspaces}
      threads={threads}
      selectedId={threadId}
      loading={loadingWorkspaces || loadingThreads}
      collapsed={collapsed}
      onToggle={toggleWorkspace}
      onCreate={(workspaceId) => void newConversation(workspaceId)}
      onSelect={(id) => {
        setThreadId(id)
        setTerminalWorkspaceId(threads.find((thread) => thread.id === id)?.workspaceId ?? null)
        setDrawerOpen(false)
      }}
      onReorder={(ids) => void reorder(ids)}
    />
  )

  const topbar = (
    <Topbar
      thread={selectedThread}
      panel={rightPanel}
      onToggle={togglePanel}
      onRenamed={(renamed) =>
        setThreads((current) => current.map((thread) => (thread.id === renamed.id ? renamed : thread)))
      }
      onOpenMenu={narrow ? () => setDrawerOpen(true) : undefined}
    />
  )

  const banner =
    error === null ? null : (
      <p role="alert" className="px-4 py-2 text-sm text-destructive">
        {error.message}
        {error.code !== undefined && KEY_PROBLEMS.has(error.code) ? (
          <>
            {' '}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => setUpKeys(workspacesTarget.workspaceId)}
            >
              Set up a key
            </button>
          </>
        ) : null}
      </p>
    )

  const picker =
    picking === null ? null : (
      <AgentPicker
        workspaceName={picking.workspace.name}
        agents={picking.agents}
        onPick={(agentId) => void startThread(picking.workspace.id, agentId)}
        onCancel={() => setPicking(null)}
      />
    )

  const chat = (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {picker}
      {banner}
      <div className="min-h-0 flex-1">
        <ChatPane threadId={threadId} onSetUpKeys={() => setUpKeys(selectedWorkspace?.id ?? null)} />
      </div>
    </main>
  )

  if (narrow) {
    return (
      <TooltipProvider>
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          {topbar}
          {chat}

          {drawerOpen ? (
            <div className="fixed inset-0 z-40 flex">
              <Sidebar
                side="left"
                title="Conversations"
                widths={SIDEBAR_WIDTHS.threads}
                width={Math.min(340, window.innerWidth - 56)}
                otherWidth={0}
                onWidthChange={() => {}}
                onCollapse={() => setDrawerOpen(false)}
                action={<ThemePicker />}
                footer={sidebarFooter}
              >
                {sessionList}
              </Sidebar>
              <button
                type="button"
                aria-label="Close conversations"
                className="min-w-0 flex-1 bg-black/50"
                onClick={() => setDrawerOpen(false)}
              />
            </div>
          ) : null}

          {rightPanel === null ? null : (
            <div className="fixed inset-0 z-40 flex flex-col bg-background">
              <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
                <span className="text-sm font-medium">{PANEL_TITLES[rightPanel]}</span>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRightPanel(null)}>
                  Close
                </Button>
              </div>
              <div className="flex min-h-0 flex-1">
                <RightPanel
                  kind={rightPanel}
                  width={window.innerWidth}
                  thread={selectedThread}
                  workspace={selectedWorkspace}
                  terminalWorkspaceId={terminalWorkspaceId}
                />
              </div>
            </div>
          )}

          {overlay}
        </div>
      </TooltipProvider>
    )
  }

  const leftSpace = leftCollapsed ? 0 : leftWidth
  const rightBounds = rightPanel === null ? SIDEBAR_WIDTHS.info : SIDEBAR_WIDTHS[rightPanel]
  const rightWidth = rightPanel === null ? 0 : rightWidths[rightPanel]

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
              footer={sidebarFooter}
            >
              {sessionList}
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
          {topbar}

          <div className="flex min-h-0 flex-1">
            {chat}

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
                  terminalWorkspaceId={terminalWorkspaceId}
                />
              </>
            )}
          </div>
        </div>

        {overlay}
      </div>
    </TooltipProvider>
  )
}

export default App
