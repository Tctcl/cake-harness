/** The capability catalogs the backend keeps: what a workspace and an agent can be granted. */

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

/** One MCP server definition. It never carries a secret: the consumer and secret names live on a credential. */
export interface McpServer extends Stamped {
  readonly transport: McpTransport
  readonly command: string | null
  readonly args: readonly string[]
  readonly url: string | null
  readonly envSchema: Readonly<Record<string, string>>
}

/** One way to authenticate against a server, naming secrets a secret store holds. */
export interface McpCredential {
  readonly id: string
  readonly serverId: string
  readonly label: string
  readonly consumer: string
  readonly secretMap: Readonly<Record<string, string>>
  readonly archivedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init)
  if (response.status === 204) return undefined as T
  const body = (await response.json()) as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(body.error?.message ?? `request failed with status ${response.status}`)

  return body
}

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
  readonly url?: string
  readonly envSchema?: Readonly<Record<string, string>>
}

export const serverApi = {
  list: async (archived = false): Promise<McpServer[]> =>
    (await request<{ servers: McpServer[] }>(`/mcp/servers${listQuery(archived)}`)).servers,
  create: async (input: McpServerInput): Promise<McpServer> =>
    await request<McpServer>('/mcp/servers', json('POST', input)),
  setArchived: async (id: string, archived: boolean): Promise<McpServer> =>
    await request<McpServer>(`/mcp/servers/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' }),
  remove: async (id: string): Promise<void> => await request<void>(`/mcp/servers/${id}`, { method: 'DELETE' }),
}

export interface McpCredentialInput {
  readonly label: string
  readonly consumer: string
  readonly secretMap: Readonly<Record<string, string>>
}

/** What an agent was granted. Ids, not rows: the catalogs hold the names. */
export interface ChatAgentGrants {
  readonly tools: readonly string[]
  readonly prompts: readonly string[]
  readonly skills: readonly string[]
  readonly mcpServers: readonly { readonly serverId: string; readonly credentialId: string | null }[]
}

export const getAgentGrants = async (agentId: string): Promise<ChatAgentGrants> =>
  await request<ChatAgentGrants>(`/agents/${agentId}/grants`)

export const credentialApi = {
  list: async (serverId: string, archived = false): Promise<McpCredential[]> =>
    (
      await request<{ credentials: McpCredential[] }>(
        `/mcp/servers/${serverId}/credentials${listQuery(archived)}`,
      )
    ).credentials,
  create: async (serverId: string, input: McpCredentialInput): Promise<McpCredential> =>
    await request<McpCredential>(`/mcp/servers/${serverId}/credentials`, json('POST', input)),
  setArchived: async (id: string, archived: boolean): Promise<McpCredential> =>
    await request<McpCredential>(`/mcp/credentials/${id}/${archived ? 'archive' : 'restore'}`, { method: 'POST' }),
  remove: async (id: string): Promise<void> => await request<void>(`/mcp/credentials/${id}`, { method: 'DELETE' }),
}
