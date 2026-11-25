/** The capability catalogs the backend keeps: what a workspace and an agent can be granted. */

import type { Credential, CredentialInput } from './credentials-api.ts'

/** Columns every catalog row carries; timestamps arrive as ISO strings because they crossed JSON. */
interface Stamped {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly archivedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** A prompt or a skill: text an agent is given. They differ by how the run uses them, not by shape. */
export interface CatalogEntry extends Stamped {
  readonly body: string
}

/** A tool the registry offers. The row points at code, so it is synced from the registry rather than authored here. */
export interface CatalogTool extends Stamped {
  readonly source: string
  readonly inputSchema: unknown
}

export type McpTransport = 'stdio' | 'http'

/**
 * One MCP server a workspace owns. It never carries a secret: the values under `env` name variables, and what fills them
 * lives on a credential. A server belongs to the workspace whose container runs it, so editing one here changes nothing
 * for any other workspace.
 */
export interface WorkspaceMcpServer extends Stamped {
  readonly workspaceId: string
  readonly transport: McpTransport
  /** stdio only: the executable. The rows after it in the editor are `args`. */
  readonly command: string | null
  readonly args: readonly string[]
  /** stdio only: the directory the process starts in, inside the workspace's container. */
  readonly cwd: string | null
  /** http only: the endpoint. */
  readonly url: string | null
  /** stdio only: variables handed to the process, name to value. */
  readonly env: Readonly<Record<string, string>>
  /**
   * The id credentials are filed under, so a key written on the credentials page can be offered here. Free text: the
   * server and the key are recorded separately, and either may be created first.
   */
  readonly mcpId: string | null
  /** The credential this server authenticates with, or `null` while none is chosen. */
  readonly credentialId: string | null
}

import { request } from './http.ts'

/** A server's credentials are the user's own: the dropdown offers those whose `mcpId` matches the server. */
export type McpCredential = Credential
export type McpCredentialInput = CredentialInput

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// `archived` is a query parameter, not a filter the client applies: the lists are already small, but the backend
// decides what counts as archived and the two must not drift.
const listQuery = (archived: boolean): string => (archived ? '?archived=true' : '')

export const listTools = async (): Promise<CatalogTool[]> =>
  (await request<{ tools: CatalogTool[] }>('/tools')).tools

/** Ask the backend to read its registry again; returns the catalog as it stands afterwards. */
export const syncTools = async (): Promise<CatalogTool[]> =>
  (await request<{ tools: CatalogTool[] }>('/tools/sync', { method: 'POST' })).tools

const catalogRoutes = (path: 'prompts' | 'skills') => ({
  list: async (archived: boolean): Promise<CatalogEntry[]> =>
    (await request<{ entries: CatalogEntry[] }>(`/${path}${listQuery(archived)}`)).entries,
  create: async (input: { name: string; description: string; body: string }): Promise<CatalogEntry> =>
    await request<CatalogEntry>(`/${path}`, json('POST', input)),
  update: async (id: string, patch: { name?: string; description?: string; body?: string }): Promise<CatalogEntry> =>
    await request<CatalogEntry>(`/${path}/${id}`, json('PATCH', patch)),
  setArchived: async (id: string, archived: boolean): Promise<CatalogEntry> =>
    await request<CatalogEntry>(`/${path}/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' }),
  remove: async (id: string): Promise<void> => await request<void>(`/${path}/${id}`, { method: 'DELETE' }),
})

export const promptApi = catalogRoutes('prompts')
export const skillApi = catalogRoutes('skills')

export interface McpServerInput {
  readonly name: string
  readonly description: string
  readonly transport: McpTransport
  readonly command?: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly url?: string
  readonly env?: Readonly<Record<string, string>>
  readonly mcpId?: string
  readonly credentialId?: string | null
}

/**
 * The servers of one workspace. They hang off the workspace rather than a shared catalog because a server's process runs in
 * that workspace's container: its `cwd` and its `env` only mean anything inside it.
 */
export const workspaceServerApi = {
  list: async (workspaceId: string, archived = false): Promise<WorkspaceMcpServer[]> =>
    (await request<{ servers: WorkspaceMcpServer[] }>(`/workspaces/${workspaceId}/mcp/servers${listQuery(archived)}`))
      .servers,
  create: async (workspaceId: string, input: McpServerInput): Promise<WorkspaceMcpServer> =>
    await request<WorkspaceMcpServer>(`/workspaces/${workspaceId}/mcp/servers`, json('POST', input)),
  update: async (workspaceId: string, id: string, patch: Partial<McpServerInput>): Promise<WorkspaceMcpServer> =>
    await request<WorkspaceMcpServer>(`/workspaces/${workspaceId}/mcp/servers/${id}`, json('PATCH', patch)),
  setArchived: async (workspaceId: string, id: string, archived: boolean): Promise<WorkspaceMcpServer> =>
    await request<WorkspaceMcpServer>(`/workspaces/${workspaceId}/mcp/servers/${id}/${archived ? 'archive' : 'restore'}`, {
      method: 'POST',
    }),
  remove: async (workspaceId: string, id: string): Promise<void> =>
    await request<void>(`/workspaces/${workspaceId}/mcp/servers/${id}`, { method: 'DELETE' }),
}

/** What an agent was granted. Ids, not rows: the catalogs hold the names. */
export interface ChatAgentGrants {
  readonly tools: readonly string[]
  readonly prompts: readonly string[]
  readonly skills: readonly string[]
  /** Ids of the servers its workspace owns: an agent selects among them rather than naming one of its own. */
  readonly mcpServers: readonly string[]
}

/** What a workspace was granted, and whether it reaches everything instead. Ids, not rows. MCP servers are not
 * granted, because the workspace owns them already. */
export interface WorkspaceGrants {
  readonly tools: readonly string[]
  readonly prompts: readonly string[]
  readonly skills: readonly string[]
}

export interface WorkspaceGrantState {
  readonly allowAll: boolean
  readonly grants: WorkspaceGrants
}

export const getWorkspaceGrants = async (workspaceId: string): Promise<WorkspaceGrantState> =>
  await request<WorkspaceGrantState>(`/workspaces/${workspaceId}/grants`)

/** One call for the whole selection: the backend replaces what the workspace reaches rather than patching it. */
export const setWorkspaceGrants = async (
  workspaceId: string,
  state: WorkspaceGrantState,
): Promise<WorkspaceGrantState> =>
  await request<WorkspaceGrantState>(`/workspaces/${workspaceId}/grants`, json('PUT', state))

export const getAgentGrants = async (agentId: string): Promise<ChatAgentGrants> =>
  await request<ChatAgentGrants>(`/agents/${agentId}/grants`)

