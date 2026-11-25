import { useState } from 'react'

import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import { Badge } from '../ui/badge.tsx'
import { WorkspaceCapabilities } from './workspace-capabilities.tsx'
import { WorkspaceEnvironmentPanel } from './workspace-environment.tsx'
import { WorkspaceMcp } from './workspace-mcp.tsx'
import { WorkspaceOverview } from './workspace-overview.tsx'
import { WorkspaceProviders } from './workspace-providers.tsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'environment', label: 'Environment' },
  { id: 'mcp', label: 'MCP' },
  { id: 'skills', label: 'Skills' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'tools', label: 'Tools' },
  { id: 'providers', label: 'Providers' },
] as const

type TabId = (typeof TABS)[number]['id']

/**
 * One workspace, everything about it: the tabs are the parts of its setup, and each panel loads only its own data. A tab
 * that has nothing to change yet says so instead of drawing controls the container would ignore.
 */
export function WorkspaceDetail({
  workspace,
  onChanged,
}: {
  workspace: WorkspaceSummary
  /** Ask the shell to read the workspace list again after a rename, an archive or a change of reach. */
  onChanged: () => void
}) {
  const [tab, setTab] = useState<TabId>('overview')

  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-2 px-6 pt-6">
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

      <div role="tablist" aria-label={`${workspace.name} settings`} className="mt-4 flex flex-wrap gap-1 border-b px-6">
        {TABS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            id={`tab-${candidate.id}`}
            aria-selected={candidate.id === tab}
            aria-controls={`panel-${candidate.id}`}
            onClick={() => setTab(candidate.id)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm hover:text-foreground ${
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
        className="min-w-0 px-6 py-6"
      >
        {tab === 'overview' ? <WorkspaceOverview workspace={workspace} onChanged={onChanged} /> : null}
        {tab === 'environment' ? <WorkspaceEnvironmentPanel workspaceId={workspace.id} /> : null}
        {tab === 'mcp' ? <WorkspaceMcp workspaceId={workspace.id} /> : null}
        {tab === 'skills' ? <WorkspaceCapabilities workspaceId={workspace.id} kind="skills" /> : null}
        {tab === 'prompts' ? <WorkspaceCapabilities workspaceId={workspace.id} kind="prompts" /> : null}
        {tab === 'tools' ? <WorkspaceCapabilities workspaceId={workspace.id} kind="tools" /> : null}
        {tab === 'providers' ? <WorkspaceProviders workspaceId={workspace.id} /> : null}
      </div>
    </div>
  )
}
