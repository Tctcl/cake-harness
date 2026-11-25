import { useState } from 'react'

import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import { Badge } from '../ui/badge.tsx'
import { WorkspaceAgents } from './workspace-agents.tsx'
import { WorkspaceCapabilities } from './workspace-capabilities.tsx'
import { WorkspaceEnvironmentPanel } from './workspace-environment.tsx'
import { WorkspaceMcp } from './workspace-mcp.tsx'
import { WorkspaceOverview } from './workspace-overview.tsx'
import { WorkspaceProviders } from './workspace-providers.tsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'providers', label: 'Providers' },
  { id: 'environment', label: 'Environment' },
  { id: 'mcp', label: 'MCP' },
  { id: 'skills', label: 'Skills' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'tools', label: 'Tools' },
] as const

/** Tabs whose settings are stored and shown, but which no run reads yet (docs/deferred.md, item 2). */
const NOT_WIRED: ReadonlySet<TabId> = new Set<TabId>(['mcp', 'skills', 'prompts', 'tools'])

export type WorkspaceTabId = (typeof TABS)[number]['id']
type TabId = WorkspaceTabId

/**
 * One workspace, everything about it: the tabs are the parts of its setup, and each panel loads only its own data. A tab
 * that has nothing to change yet says so instead of drawing controls the container would ignore.
 */
export function WorkspaceDetail({
  workspace,
  onChanged,
  onOpenCredentials,
  initialTab = 'overview',
}: {
  workspace: WorkspaceSummary
  /** Ask the shell to read the workspace list again after a rename, an archive or a change of reach. */
  onChanged: () => void
  /** Leave for Settings → Credentials, where keys are added. */
  onOpenCredentials: () => void
  /** The tab to open on, so a "set up a key" link can land on Providers. */
  initialTab?: TabId
}) {
  const [tab, setTab] = useState<TabId>(initialTab)

  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-2 px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg font-semibold">{workspace.name}</h1>
          {workspace.isDefault ? (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Default
            </Badge>
          ) : null}
          {workspace.allowAll ? (
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              Reaches everything
            </Badge>
          ) : null}
        </div>
        {workspace.description === '' ? null : (
          <p className="text-sm text-muted-foreground">{workspace.description}</p>
        )}
      </header>

      <div role="tablist" aria-label={`${workspace.name} settings`} className="mt-4 flex gap-1 overflow-x-auto border-b px-4 sm:px-6">
        {TABS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            id={`tab-${candidate.id}`}
            aria-selected={candidate.id === tab}
            aria-controls={`panel-${candidate.id}`}
            onClick={() => setTab(candidate.id)}
            className={`-mb-px shrink-0 rounded-t-md border-b-2 px-3 py-2 text-sm hover:text-foreground ${
              candidate.id === tab
                ? 'border-foreground font-medium text-foreground'
                : 'border-transparent text-muted-foreground'
            }`}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="min-w-0 px-4 py-4 sm:px-6 sm:py-6"
      >
        {NOT_WIRED.has(tab) ? (
          <p className="mb-4 max-w-3xl rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Stored and editable, but not used by agents yet: conversations currently run with no tools, MCP servers,
            skills or prompt catalog entries. An agent&rsquo;s system prompt and instructions do apply.
          </p>
        ) : null}
        {tab === 'overview' ? <WorkspaceOverview workspace={workspace} onChanged={onChanged} /> : null}
        {tab === 'environment' ? <WorkspaceEnvironmentPanel workspaceId={workspace.id} /> : null}
        {tab === 'mcp' ? <WorkspaceMcp workspaceId={workspace.id} /> : null}
        {tab === 'skills' ? <WorkspaceCapabilities workspaceId={workspace.id} kind="skills" /> : null}
        {tab === 'prompts' ? <WorkspaceCapabilities workspaceId={workspace.id} kind="prompts" /> : null}
        {tab === 'tools' ? <WorkspaceCapabilities workspaceId={workspace.id} kind="tools" /> : null}
        {tab === 'agents' ? (
          <WorkspaceAgents workspace={workspace} onOpenProviders={() => setTab('providers')} />
        ) : null}
        {tab === 'providers' ? (
          <WorkspaceProviders workspace={workspace} onOpenCredentials={onOpenCredentials} />
        ) : null}
      </div>
    </div>
  )
}
