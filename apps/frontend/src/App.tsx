import { useCallback, useEffect, useState } from 'react'

import { ChatPane } from './components/chat/chat-pane.tsx'
import { ConversationSidebar } from './components/layout/conversation-sidebar.tsx'
import { ResizeHandle, Sidebar, SidebarRail } from './components/layout/sidebar.tsx'
import { ThemePicker } from './components/layout/theme-picker.tsx'
import { ThreadInfoSidebar } from './components/layout/thread-info.tsx'
import { UserMenu } from './components/layout/user-menu.tsx'
import { SettingsPage } from './components/settings/settings-page.tsx'
import { TooltipProvider } from './components/ui/tooltip.tsx'
import { CreateWorkspaceDialog, ManageWorkspacesDialog } from './components/layout/workspace-dialogs.tsx'
import { WorkspacePicker } from './components/layout/workspace-picker.tsx'
import type { ChatThread, CurrentUser, WorkspaceSummary } from './lib/chat-api.ts'
import { createThread, getMe, listThreads, listWorkspaces } from './lib/chat-api.ts'

const LEFT_WIDTH = 260
const RIGHT_WIDTH = 280

/**
 * Conversations on the left with the workspace they belong to at its foot, the chat in the middle, the open
 * conversation's agent and spend on the right. Switching conversations or workspaces never closes a run: the stream
 * belongs to the thread store, not to the pane that happens to be mounted.
 *
 * Settings is a screen, not a pane: it replaces the three columns wholesale and comes back to them unchanged.
 */
function App() {
  const [view, setView] = useState<'chat' | 'settings'>('chat')
  const [me, setMe] = useState<CurrentUser | null>(null)
  const [loadingMe, setLoadingMe] = useState(true)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [threadsOf, setThreadsOf] = useState<string | null>(null)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [managingWorkspaces, setManagingWorkspaces] = useState(false)

  const [leftWidth, setLeftWidth] = useState(LEFT_WIDTH)
  const [rightWidth, setRightWidth] = useState(RIGHT_WIDTH)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  const loadWorkspaces = useCallback(() => {
    void listWorkspaces().then(
      (loaded) => {
        setWorkspaces(loaded)
        setWorkspaceId(
          (current) =>
            loaded.find((workspace) => workspace.id === current)?.id ??
            loaded.find((workspace) => workspace.isDefault)?.id ??
            loaded[0]?.id ??
            null,
        )
        setLoadingWorkspaces(false)
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'workspaces failed to load')
        setLoadingWorkspaces(false)
      },
    )
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

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

  useEffect(() => {
    if (workspaceId === null) return

    let cancelled = false

    void listThreads(workspaceId).then(
      (loaded) => {
        if (cancelled) return
        setThreads(loaded)
        setThreadsOf(workspaceId)
      },
      (failure: unknown) => {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : 'conversations failed to load')
        setThreadsOf(workspaceId)
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  async function startThread() {
    if (workspaceId === null) return

    try {
      const created = await createThread(workspaceId)
      setThreads((current) => [created, ...current])
      setThreadsOf(workspaceId)
      setThreadId(created.id)
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the conversation failed to start')
    }
  }

  const selectedThread = threads.find((thread) => thread.id === threadId) ?? null
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null
  const leftSpace = leftCollapsed ? 0 : leftWidth
  const rightSpace = rightCollapsed ? 0 : rightWidth
  const loadingThreads = workspaceId !== null && threadsOf !== workspaceId

  if (view === 'settings') {
    return (
      <TooltipProvider>
        <div className="h-full min-h-0">
          <SettingsPage user={me} onClose={() => setView('chat')} />
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
              width={leftWidth}
              otherWidth={rightSpace}
              onWidthChange={setLeftWidth}
              onCollapse={() => setLeftCollapsed(true)}
              action={<ThemePicker />}
              footer={
                <div className="flex flex-col gap-2">
                  <WorkspacePicker
                    workspaces={workspaces}
                    selectedId={workspaceId}
                    loading={loadingWorkspaces}
                    onSelect={setWorkspaceId}
                    onCreate={() => setCreatingWorkspace(true)}
                    onManage={() => setManagingWorkspaces(true)}
                  />
                  <UserMenu user={me} loading={loadingMe} onOpenSettings={() => setView('settings')} />
                </div>
              }
            >
              <ConversationSidebar
                threads={threads}
                selectedId={threadId}
                loading={loadingThreads}
                onCreate={() => void startThread()}
                onSelect={setThreadId}
              />
            </Sidebar>
            <ResizeHandle
              side="left"
              width={leftWidth}
              otherWidth={rightSpace}
              onWidthChange={setLeftWidth}
              onCollapse={() => setLeftCollapsed(true)}
            />
          </>
        )}

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

        {rightCollapsed ? (
          <SidebarRail side="right" title="Conversation" onExpand={() => setRightCollapsed(false)} />
        ) : (
          <>
            <ResizeHandle
              side="right"
              width={rightWidth}
              otherWidth={leftSpace}
              onWidthChange={setRightWidth}
              onCollapse={() => setRightCollapsed(true)}
            />
            <Sidebar
              side="right"
              title="Conversation"
              width={rightWidth}
              otherWidth={leftSpace}
              onWidthChange={setRightWidth}
              onCollapse={() => setRightCollapsed(true)}
            >
              <ThreadInfoSidebar
                thread={selectedThread}
                workspace={selectedWorkspace}
                onRenamed={(renamed) =>
                  setThreads((current) =>
                    current.map((thread) => (thread.id === renamed.id ? renamed : thread)),
                  )
                }
              />
            </Sidebar>
          </>
        )}
      </div>

      <CreateWorkspaceDialog
        open={creatingWorkspace}
        onOpenChange={setCreatingWorkspace}
        onCreated={(created) => {
          setWorkspaces((current) => [...current, created])
          setWorkspaceId(created.id)
        }}
      />
      <ManageWorkspacesDialog
        open={managingWorkspaces}
        onOpenChange={setManagingWorkspaces}
        workspaces={workspaces}
        onChanged={loadWorkspaces}
      />
    </TooltipProvider>
  )
}

export default App
