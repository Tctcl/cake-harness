import type { AgentRepository } from '../agents/agent-repository.js'
import { mergeRunSettings, validateRunSettings } from '../agents/run-settings.js'
import type { KeyCatalog, RunSettingsPatch, WorkspaceReach } from '../agents/run-settings.js'
import { AppError } from '../errors.js'
import type { ChatThread, ThreadRepository } from './thread-repository.js'

export interface ThreadRunSettingsStores {
  readonly threads: Pick<ThreadRepository, 'find' | 'updateRunSettings'>
  readonly agents: Pick<AgentRepository, 'find'>
  readonly reachOf: (workspaceId: string) => Promise<WorkspaceReach>
  readonly keyCatalog: () => Promise<KeyCatalog>
}

/** Validate the whole effective selection, then store only this conversation's departures from its agent. */
export const updateThreadRunSettings = async (
  stores: ThreadRunSettingsStores,
  id: string,
  patch: RunSettingsPatch,
): Promise<ChatThread | undefined> => {
  const thread = await stores.threads.find(id)
  if (thread === undefined) return undefined

  const profile = await stores.agents.find(thread.agentId)
  if (profile === undefined) {
    throw new AppError('the agent does not exist', { statusCode: 404, code: 'AGENT_NOT_FOUND' })
  }

  const effective = mergeRunSettings(profile, { ...thread.overrides, ...patch })
  const [reach, keys] = await Promise.all([stores.reachOf(thread.workspaceId), stores.keyCatalog()])
  validateRunSettings(effective, reach, keys)

  return stores.threads.updateRunSettings(id, patch)
}
