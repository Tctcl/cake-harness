import { defineEntry } from '@earendil-works/pi-durable'
import type { JsonValue } from '@earendil-works/chord/json'

import type { AgentProfile, AgentRepository } from '../agents/agent-repository.js'
import type { KeyCatalog, RunSettingsOverrideKey, WorkspaceReach } from '../agents/run-settings.js'
import { unusableOverrides } from '../agents/run-settings.js'
import { AppError } from '../errors.js'
import type { ChatThread, ThreadRepository } from './thread-repository.js'

/**
 * The divider a switch leaves in the transcript. It is a display-only entry — no `model` — so the conversation keeps a
 * visible record of when it changed agent and the model never reads it as if the person had typed it.
 */
export const AgentSwitchEntry = defineEntry<{ agentId: string; agentName: string }>('cake.agent-switch')

/** The agent a switch entry names, for the transcript projection. */
export interface SwitchedAgent {
  readonly agentId: string
  readonly agentName: string
}

/** The agent a switch divider records, if the entry carries one. */
export const switchedAgentOf = (data: JsonValue | undefined): SwitchedAgent | undefined => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const agentId = data['agentId']
  const agentName = data['agentName']
  if (typeof agentId !== 'string' || typeof agentName !== 'string') return undefined

  return { agentId, agentName }
}

export interface AgentSwitchStores {
  readonly threads: Pick<ThreadRepository, 'find' | 'setAgent' | 'updateRunSettings'>
  readonly agents: Pick<AgentRepository, 'find'>
  readonly reachOf: (workspaceId: string) => Promise<WorkspaceReach>
  readonly keyCatalog: () => Promise<KeyCatalog>
  /** Write the divider, once the row already names the new agent: the row is the state, the entry its history. */
  readonly record: (thread: ChatThread, agent: AgentProfile) => Promise<void>
}

export interface AgentSwitch {
  readonly thread: ChatThread
  /** Overrides dropped because they no longer hold here; a caller reports them so the change is not silent. */
  readonly clearedOverrides: readonly RunSettingsOverrideKey[]
}

const agentNotFound = (): AppError =>
  new AppError('the agent does not exist', { statusCode: 404, code: 'AGENT_NOT_FOUND' })

/**
 * Point a conversation at another agent of its workspace. It takes effect from the next message because the agent is
 * resolved per submission; nothing interrupts a run already in flight.
 */
export const switchThreadAgent = async (
  stores: AgentSwitchStores,
  id: string,
  agentId: string,
): Promise<AgentSwitch | undefined> => {
  const thread = await stores.threads.find(id)
  if (thread === undefined) return undefined
  if (thread.archivedAt !== null) {
    throw new AppError('the thread is archived', { statusCode: 409, code: 'THREAD_ARCHIVED' })
  }

  const agent = await stores.agents.find(agentId)
  // A sub agent answers a parent agent, never a person: it cannot own a conversation.
  if (agent === undefined || agent.kind !== 'agent') throw agentNotFound()
  if (agent.workspaceId !== thread.workspaceId) {
    throw new AppError('the agent belongs to another workspace', {
      statusCode: 400,
      code: 'AGENT_WORKSPACE_MISMATCH',
    })
  }
  if (agent.archivedAt !== null) {
    throw new AppError('the agent is archived', { statusCode: 409, code: 'AGENT_ARCHIVED' })
  }

  // Switching to the agent already running the conversation changes nothing, so it writes no divider either.
  if (thread.agentId === agent.id) return { thread, clearedOverrides: [] }

  const [reach, keys] = await Promise.all([stores.reachOf(thread.workspaceId), stores.keyCatalog()])
  const clearedOverrides = unusableOverrides(thread.overrides, reach, keys)
  const switched = await stores.threads.setAgent(id, agent.id)
  if (switched === undefined) return undefined

  const settled = clearedOverrides.length === 0
    ? switched
    : await stores.threads.updateRunSettings(id, {
        ...(clearedOverrides.includes('credentialId') ? { credentialId: null } : {}),
        ...(clearedOverrides.includes('modelId') ? { modelId: null } : {}),
        ...(clearedOverrides.includes('thinkingLevel') ? { thinkingLevel: null } : {}),
      })
  // The row already names the new agent before its divider is written: a failed divider must not undo the switch.
  const current = settled ?? switched
  await stores.record(current, agent)

  return { thread: current, clearedOverrides }
}
