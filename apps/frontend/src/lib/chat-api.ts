import { request } from './http.ts'

/** The identity block above the workspace picker reads this: who the sessions belong to. */
export interface CurrentUser {
  readonly id: string
  readonly name: string
}

/** One part of a chat line, in the order the provider produced it or the user supplied it. */
export type ChatBlock =
  | { readonly type: 'text'; readonly text: string }
  /** `redacted` reasoning has no text on purpose: the provider only lets its signature travel back. */
  | { readonly type: 'thinking'; readonly text: string; readonly redacted: boolean }
  | {
      readonly type: 'toolCall'
      readonly callId: string
      readonly name: string
      readonly arguments: string
    }

/** One line of a thread's transcript, as the backend renders it. `id` is the durable entry id and the merge key. */
export interface ChatMessage {
  readonly id: number
  readonly role: 'user' | 'assistant' | 'compaction' | 'reset' | 'context'
  readonly text: string
  readonly blocks: readonly ChatBlock[]
  readonly stopReason: string | null
  readonly errorMessage: string | null
  readonly reason: string | null
  readonly sections?: readonly { readonly key: string; readonly text: string | null }[]
  readonly toolsAdded?: readonly string[]
  readonly toolsRemoved?: readonly string[]
}

/** One tool call from the run, joined with the result that answered it. */
export interface ChatToolCall {
  readonly id: string
  readonly entryId: number
  readonly name: string
  readonly arguments: string | null
  readonly status: 'running' | 'ok' | 'error'
  readonly result: string | null
  readonly durationMs: number | null
  readonly truncated: boolean
  readonly fullByteLength: number
}

export interface ChatToolCallDetails {
  readonly arguments: string | null
  readonly result: string | null
}

/** The model the newest answer ran with; absent until the agent has answered once. */
export interface ChatRun {
  readonly model: string
  readonly provider: string
  readonly thinkingLevel: string | null
}

/** The conversation's spend so far, summed from the durable usage ledger. */
export interface ChatUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly total: number
  readonly cost: number
}

/** One block of the answer still being written, in the order the provider produced it. */
export type ChatLiveBlock = ChatBlock

/** A tool call as the run holds it now: the live slot, before the entry that will record it exists. */
export interface ChatLiveTool {
  readonly id: string
  readonly name: string
  readonly status: 'pending' | 'running' | 'sleeping' | 'waiting' | 'done'
  readonly output: string | null
  readonly droppedBytes: number
  readonly droppedLines: number
  readonly diagnostics: readonly string[]
  readonly question: { readonly text: string; readonly options: readonly string[]; readonly allowFreeText: boolean } | null
}

/** Why a run ended without an answer, kept until a later run starts. */
export interface ChatRunFailure {
  readonly reason: string
  readonly detail: string | null
}

/** What the conversation is doing right now, straight from the durable live state. */
export interface ChatLive {
  readonly blocks: readonly ChatLiveBlock[]
  readonly tools: readonly ChatLiveTool[]
  readonly turns: number
  readonly compacting: number
  readonly failure: ChatRunFailure | null
}

/** A compact child conversation embedded in its parent's stream frame. */
export interface ChatDelegation {
  readonly id: string
  readonly subagentId: string
  readonly subagentName: string
  readonly status: 'running' | 'done' | 'failed'
  readonly worktreePath: string | null
  readonly worktreeBranch: string | null
  readonly live: ChatLive
  readonly messages: readonly ChatMessage[]
}

/** One frame of the stream: the visible window, its tool traffic, and the sums that describe the run. */
export interface ChatUpdate {
  readonly messages: ChatMessage[]
  readonly tools: ChatToolCall[]
  readonly run: ChatRun | null
  readonly usage: ChatUsage
  /** Absent only from a server that predates the live view; the client then treats the run as idle. */
  readonly live?: ChatLive
  readonly delegations: readonly ChatDelegation[]
}

export interface RunSettingsOverrides {
  readonly credentialId: string | null
  readonly modelId: string | null
  readonly thinkingLevel: ThinkingLevel | null
}

export type RunSettingsPatch = Partial<RunSettingsOverrides>

export interface ChatThread {
  readonly id: string
  readonly title: string | null
  readonly workspaceId: string
  readonly agentId: string
  readonly overrides: RunSettingsOverrides
}

/** A whole workspace row: the ceiling its agents narrow. */
export interface WorkspaceSummary {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
  /** Whether the workspace reaches every capability, including ones added later. */
  readonly allowAll: boolean
  /** Where the workspace sits in the user's list, 0 at the top. The order is arranged by dragging, not by recency. */
  readonly position: number
}

/** One profile inside a workspace: what a conversation gets, and the text that steers it. */
export interface ChatAgent {
  readonly id: string
  readonly workspaceId: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
  /** Whether the agent reaches every available tool, rather than a narrower selection. */
  readonly allowAll: boolean
  readonly systemPromptAppend: string
  readonly instructions: string
  /** The stored key it runs with, or `null` for the workspace's newest linked key. */
  readonly credentialId: string | null
  /** The model id, or `null` for the platform default. */
  readonly modelId: string | null
  readonly thinkingLevel: ThinkingLevel
}

/** How hard the model reasons, in pi-ai's names. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** The model an agent runs when it names none; mirrors `DEFAULT_MODEL_ID` in the backend. */
export const DEFAULT_MODEL_ID = 'deepseek-v4.1-flash'

/** One page of transcript: `nextCursor` asks for the lines above it, a null cursor means the start is reached. */
export interface TranscriptPage {
  readonly messages: ChatMessage[]
  readonly nextCursor: string | null
}

export const MESSAGE_PAGE_SIZE = 40

// The backend answers failures as `{ error: { code, message } }`, so a failed call can carry its reason to the pane.
const send = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const listWorkspaces = async (): Promise<WorkspaceSummary[]> =>
  (await request<{ workspaces: WorkspaceSummary[] }>('/workspaces')).workspaces

export const getWorkspace = async (id: string): Promise<WorkspaceSummary> =>
  await request<WorkspaceSummary>(`/workspaces/${id}`)

/** The seeded local user. Until sign-in exists this is the only identity the backend can name. */
export const getMe = async (): Promise<CurrentUser> => await request<CurrentUser>('/me')

/** Every live agent of a workspace: the right sidebar names the one a conversation runs with. */
export const listAgents = async (workspaceId: string): Promise<ChatAgent[]> =>
  (await request<{ agents: ChatAgent[] }>(`/workspaces/${workspaceId}/agents`)).agents

export const createWorkspace = async (
  name: string,
  description: string,
): Promise<WorkspaceSummary> => await request<WorkspaceSummary>('/workspaces', send({ name, description }))

/** Archived, not destroyed: a workspace that sessions still point at cannot be removed outright. */
export const archiveWorkspace = async (id: string): Promise<WorkspaceSummary> =>
  await request<WorkspaceSummary>(`/workspaces/${id}/archive`, send({}))

/** One partial edit of a workspace; the fields left out keep their value. */
export const updateWorkspace = async (
  id: string,
  patch: { readonly name?: string; readonly description?: string; readonly allowAll?: boolean },
): Promise<WorkspaceSummary> =>
  await request<WorkspaceSummary>(`/workspaces/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })

/**
 * Rewrite the whole list order, top first. The ids have to be exactly the live workspaces: the backend refuses anything
 * else rather than renumbering a subset onto positions the remaining rows already hold.
 */
export const reorderWorkspaces = async (ids: readonly string[]): Promise<WorkspaceSummary[]> =>
  (
    await request<{ workspaces: WorkspaceSummary[] }>('/workspaces/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: ids }),
    })
  ).workspaces

/** Set a conversation's title; null drops it back to the untitled default. */
export const renameThread = async (id: string, title: string | null): Promise<ChatThread> =>
  await request<ChatThread>(`/threads/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  })

export const readThread = async (id: string): Promise<ChatThread> =>
  await request<ChatThread>(`/threads/${id}`)

export const listThreads = async (workspaceId: string | null): Promise<ChatThread[]> => {
  const query = workspaceId === null ? '' : `?workspaceId=${encodeURIComponent(workspaceId)}`

  return (await request<{ threads: ChatThread[] }>(`/threads${query}`)).threads
}

/** Set only this conversation's overrides; null restores the corresponding agent setting. */
export const updateThreadRunSettings = async (
  id: string,
  patch: RunSettingsPatch,
): Promise<ChatThread> =>
  await request<ChatThread>(`/threads/${id}/run-settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })

/** Without an agent the workspace's default agent answers. */
export const createThread = async (workspaceId: string, agentId?: string): Promise<ChatThread> =>
  await request<ChatThread>('/threads', send(agentId === undefined ? { workspaceId } : { workspaceId, agentId }))

/** One page of transcript, newest page first. `cursor` is the `nextCursor` of the page below this one. */
export const readMessages = async (threadId: string, cursor?: string): Promise<TranscriptPage> => {
  const query = new URLSearchParams({ limit: String(MESSAGE_PAGE_SIZE) })
  if (cursor !== undefined) query.set('cursor', cursor)

  return await request<TranscriptPage>(`/threads/${threadId}/messages?${query.toString()}`)
}

/** Fetch the unabridged entry data only when a reader expands a clipped tool call. */
export const readToolCallDetails = async (threadId: string, callId: string): Promise<ChatToolCallDetails> =>
  await request<ChatToolCallDetails>(
    `/threads/${threadId}/tool-calls/${encodeURIComponent(callId)}`,
  )

/**
 * Hand one message to the agent. The answer arrives on the thread's stream, not in this response, so a resolved promise
 * only means the input was admitted.
 */
export const sendMessage = async (threadId: string, message: string): Promise<void> => {
  await request(`/threads/${threadId}/messages`, send({ message }))
}

/** Deliver the person's answer to one parked ask_user call. */
export const answerQuestion = async (threadId: string, callId: string, answer: string): Promise<void> => {
  await request(
    `/threads/${threadId}/questions/${encodeURIComponent(callId)}/answer`,
    send({ answer }),
  )
}

export const streamPath = (threadId: string): string => `/threads/${threadId}/stream`
