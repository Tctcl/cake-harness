import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import { AppError } from '../errors.js'
import type { Value } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/** How a server is reached: a process started in the workspace's container, or an endpoint over the network. */
export type McpTransport = 'stdio' | 'http'

/**
 * One MCP server a workspace owns. It never carries a secret: `credentialId` names a stored credential, and that row
 * holds the value. A server belongs to the workspace whose container runs it, so `cwd` and `env` describe that
 * container and nothing else.
 */
export interface WorkspaceMcpServer {
  readonly id: string
  readonly workspaceId: string
  readonly name: string
  readonly description: string
  readonly transport: McpTransport
  /** stdio only: the executable. */
  readonly command: string | null
  readonly args: readonly string[]
  /** stdio only: the directory the process starts in, inside the workspace's container. */
  readonly cwd: string | null
  /** http only: the endpoint. */
  readonly url: string | null
  /** stdio only: variables handed to the process, name to value. */
  readonly env: Readonly<Record<string, string>>
  /** The id credentials are filed under, so a key written on the credentials page can be offered here. */
  readonly mcpId: string | null
  /** The credential this server authenticates with, or `null` while none is chosen. */
  readonly credentialId: string | null
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface WorkspaceMcpServerInput {
  readonly name: string
  readonly description?: string
  readonly transport: McpTransport
  readonly command?: string | null
  readonly args?: readonly string[]
  readonly cwd?: string | null
  readonly url?: string | null
  readonly env?: Readonly<Record<string, string>>
  readonly mcpId?: string | null
  readonly credentialId?: string | null
}

export type WorkspaceMcpServerPatch = Partial<WorkspaceMcpServerInput>

interface WorkspaceMcpServerRow {
  readonly id: string
  readonly workspace_id: string
  readonly name: string
  readonly description: string
  readonly transport: McpTransport
  readonly command: string | null
  readonly args: string[]
  readonly cwd: string | null
  readonly url: string | null
  readonly env: unknown
  readonly mcp_id: string | null
  readonly credential_id: string | null
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

const COLUMNS = `id, workspace_id, name, description, transport, command, args, cwd, url, env, mcp_id,
  credential_id, archived_at, created_at, updated_at`

/** A jsonb column read back into a string map: anything else in the column was not written by this module. */
const toMapping = (value: unknown): Readonly<Record<string, string>> => {
  if (typeof value !== 'object' || value === null) return {}

  const pairs = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )

  return Object.fromEntries(pairs)
}

const toServer = (row: WorkspaceMcpServerRow): WorkspaceMcpServer => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  description: row.description,
  transport: row.transport,
  command: row.command,
  args: row.args,
  cwd: row.cwd,
  url: row.url,
  env: toMapping(row.env),
  mcpId: row.mcp_id,
  credentialId: row.credential_id,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const visibleClause = (archived: boolean | undefined): string =>
  archived === true ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'

const notFound = (): AppError =>
  new AppError('the MCP server does not exist', { statusCode: 404, code: 'MCP_NOT_FOUND' })

/** The unique index on the name is the one constraint a writer can trip, and it deserves a stable code. */
const NAME_TAKEN = '23505'

const rethrow = (error: unknown): never => {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === NAME_TAKEN) {
    throw new AppError('an MCP server with that name already exists in this workspace', {
      statusCode: 409,
      code: 'NAME_TAKEN',
    })
  }

  throw error instanceof Error ? error : new Error(String(error))
}

/**
 * Reads and writes `workspace_mcp_servers`. Every statement is scoped by workspace as well as by id, so an id from
 * another workspace answers 404 rather than editing a row the caller cannot see.
 */
export class WorkspaceMcpServerRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema
  readonly #delete: string
  readonly #linked: string

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema
    this.#delete = `DELETE FROM ${schema.tables.workspaceMcpServers} WHERE id = $1`
    this.#linked = `SELECT 1 FROM ${schema.tables.agentMcpServers} WHERE mcp_server_id = $1 LIMIT 1`
  }

  async list(
    workspaceId: string,
    options: { archived?: boolean | undefined } = {},
  ): Promise<WorkspaceMcpServer[]> {
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.workspaceMcpServers}
      WHERE workspace_id = $1 AND ${visibleClause(options.archived)} ORDER BY name`

    return (await this.#pool.query<WorkspaceMcpServerRow>(text, [workspaceId])).rows.map(toServer)
  }

  async find(workspaceId: string, id: string): Promise<WorkspaceMcpServer | undefined> {
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.workspaceMcpServers}
      WHERE id = $1 AND workspace_id = $2`

    return (await this.#pool.query<WorkspaceMcpServerRow>(text, [id, workspaceId])).rows.map(toServer)[0]
  }

  async create(workspaceId: string, input: WorkspaceMcpServerInput): Promise<WorkspaceMcpServer> {
    const text = `INSERT INTO ${this.#schema.tables.workspaceMcpServers}
      (id, workspace_id, name, description, transport, command, args, cwd, url, env, mcp_id, credential_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${COLUMNS}`
    const values: Value[] = [
      randomUUID(),
      workspaceId,
      input.name,
      input.description ?? '',
      input.transport,
      input.command ?? null,
      [...(input.args ?? [])],
      input.cwd ?? null,
      input.url ?? null,
      JSON.stringify(input.env ?? {}),
      input.mcpId ?? null,
      input.credentialId ?? null,
    ]

    try {
      return toServer(await this.#one(text, values))
    } catch (error) {
      return rethrow(error)
    }
  }

  async update(
    workspaceId: string,
    id: string,
    patch: WorkspaceMcpServerPatch,
  ): Promise<WorkspaceMcpServer> {
    const assignments: string[] = []
    const values: Value[] = [id, workspaceId]
    const bind = (column: string, value: Value): void => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }
    if (patch.name !== undefined) bind('name', patch.name)
    if (patch.description !== undefined) bind('description', patch.description)
    if (patch.transport !== undefined) bind('transport', patch.transport)
    if (patch.command !== undefined) bind('command', patch.command)
    if (patch.args !== undefined) bind('args', [...patch.args])
    if (patch.cwd !== undefined) bind('cwd', patch.cwd)
    if (patch.url !== undefined) bind('url', patch.url)
    if (patch.env !== undefined) bind('env', JSON.stringify(patch.env))
    if (patch.mcpId !== undefined) bind('mcp_id', patch.mcpId)
    if (patch.credentialId !== undefined) bind('credential_id', patch.credentialId)
    if (assignments.length === 0) return await this.#require(workspaceId, id)

    assignments.push('updated_at = now()')
    const text = `UPDATE ${this.#schema.tables.workspaceMcpServers} SET ${assignments.join(', ')}
      WHERE id = $1 AND workspace_id = $2 RETURNING ${COLUMNS}`

    try {
      return toServer(await this.#one(text, values))
    } catch (error) {
      return rethrow(error)
    }
  }

  async archive(workspaceId: string, id: string): Promise<WorkspaceMcpServer> {
    const text = `UPDATE ${this.#schema.tables.workspaceMcpServers}
      SET archived_at = now(), updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING ${COLUMNS}`

    return toServer(await this.#one(text, [id, workspaceId]))
  }

  async restore(workspaceId: string, id: string): Promise<WorkspaceMcpServer> {
    const text = `UPDATE ${this.#schema.tables.workspaceMcpServers}
      SET archived_at = NULL, updated_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING ${COLUMNS}`

    return toServer(await this.#one(text, [id, workspaceId]))
  }

  /** Refused while an agent still names it: an agent whose server vanished would run with a config it does not have. */
  async delete(workspaceId: string, id: string): Promise<void> {
    if ((await this.find(workspaceId, id)) === undefined) throw notFound()
    if ((await this.#pool.query(this.#linked, [id])).rows.length > 0) {
      throw new AppError('an agent still uses this MCP server', { statusCode: 409, code: 'CAPABILITY_IN_USE' })
    }

    await this.#pool.query(this.#delete, [id])
  }

  async #require(workspaceId: string, id: string): Promise<WorkspaceMcpServer> {
    const found = await this.find(workspaceId, id)
    if (found === undefined) throw notFound()

    return found
  }

  async #one(text: string, values: readonly Value[]): Promise<WorkspaceMcpServerRow> {
    const { rows } = await this.#pool.query<WorkspaceMcpServerRow>(text, [...values])
    const row = rows[0]
    if (row === undefined) throw notFound()

    return row
  }
}
