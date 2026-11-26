import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import { WorkspaceProfiles } from './workspace-profiles.tsx'

/** The delegation-only profiles of one workspace. */
export function WorkspaceSubagents({
  workspace,
  onOpenProviders,
}: {
  workspace: WorkspaceSummary
  onOpenProviders: () => void
}) {
  return <WorkspaceProfiles kind="subagent" workspace={workspace} onOpenProviders={onOpenProviders} />
}
