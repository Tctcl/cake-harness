import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import { WorkspaceProfiles } from './workspace-profiles.tsx'

/** The ordinary conversation profiles of one workspace. */
export function WorkspaceAgents({
  workspace,
  onOpenProviders,
}: {
  workspace: WorkspaceSummary
  onOpenProviders: () => void
}) {
  return <WorkspaceProfiles kind="agent" workspace={workspace} onOpenProviders={onOpenProviders} />
}
