import type { ChatAgent, ThinkingLevel } from './chat-api.ts'
import { request } from './http.ts'

/** What the agent form edits. `null` for the key or the model hands it back to the workspace default. */
export interface AgentDraft {
  readonly name: string
  readonly description: string
  readonly allowAll: boolean
  readonly systemPrompt: string
  readonly instructions: string
  readonly credentialId: string | null
  readonly modelId: string | null
  readonly thinkingLevel: ThinkingLevel
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const base = (workspaceId: string): string => `/workspaces/${workspaceId}/agents`

export const listWorkspaceAgents = async (workspaceId: string, archived = false): Promise<ChatAgent[]> =>
  (await request<{ agents: ChatAgent[] }>(`${base(workspaceId)}${archived ? '?archived=true' : ''}`)).agents

export const createAgent = async (workspaceId: string, draft: AgentDraft): Promise<ChatAgent> =>
  await request<ChatAgent>(base(workspaceId), json('POST', draft))

export const updateAgent = async (workspaceId: string, id: string, draft: Partial<AgentDraft>): Promise<ChatAgent> =>
  await request<ChatAgent>(`${base(workspaceId)}/${id}`, json('PATCH', draft))

/** Archiving takes the agent's conversations with it; restoring brings back the agent alone. */
export const setAgentArchived = async (workspaceId: string, id: string, archived: boolean): Promise<ChatAgent> =>
  await request<ChatAgent>(`${base(workspaceId)}/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' })

/** Only an archived agent can be deleted, together with its archived conversations. */
export const deleteAgent = async (workspaceId: string, id: string): Promise<void> => {
  await request<void>(`${base(workspaceId)}/${id}`, { method: 'DELETE' })
}
