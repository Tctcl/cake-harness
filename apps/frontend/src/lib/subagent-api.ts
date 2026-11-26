import type { ThinkingLevel } from './chat-api.ts'
import { request } from './http.ts'

/** A profile a parent agent can delegate to, including the models a delegation may choose. */
export interface ChatSubagent {
  readonly id: string
  readonly workspaceId: string
  readonly name: string
  readonly description: string
  readonly allowAll: boolean
  readonly systemPromptAppend: string
  readonly instructions: string
  readonly credentialId: string | null
  /** The model used when the parent does not deliberately choose another allowed one. */
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
  readonly allowedModels: readonly string[]
  readonly callableBy: readonly string[]
  readonly archivedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SubagentDraft {
  readonly name: string
  readonly description: string
  readonly allowAll: boolean
  readonly systemPromptAppend: string
  readonly instructions: string
  readonly credentialId: string | null
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
  readonly allowedModels: readonly string[]
  readonly callableBy: readonly string[]
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

const base = (workspaceId: string): string => `/workspaces/${workspaceId}/subagents`

export const listWorkspaceSubagents = async (workspaceId: string, archived = false): Promise<ChatSubagent[]> =>
  (await request<{ subagents: ChatSubagent[] }>(`${base(workspaceId)}${archived ? '?archived=true' : ''}`)).subagents

export const createSubagent = async (workspaceId: string, draft: SubagentDraft): Promise<ChatSubagent> =>
  await request<ChatSubagent>(base(workspaceId), json('POST', draft))

export const updateSubagent = async (
  workspaceId: string,
  id: string,
  draft: Partial<SubagentDraft>,
): Promise<ChatSubagent> => await request<ChatSubagent>(`${base(workspaceId)}/${id}`, json('PATCH', draft))

export const setSubagentArchived = async (
  workspaceId: string,
  id: string,
  archived: boolean,
): Promise<ChatSubagent> =>
  await request<ChatSubagent>(`${base(workspaceId)}/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' })

/** Only an archived sub agent can be deleted; the backend preserves ones named by delegation history. */
export const deleteSubagent = async (workspaceId: string, id: string): Promise<void> => {
  await request<void>(`${base(workspaceId)}/${id}`, { method: 'DELETE' })
}
