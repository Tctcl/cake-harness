import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import { AppError } from '../errors.js'
import type { Value } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/** How a server is reached: a process started on this host, or an endpoint over the network. */
export type McpTransport = 'stdio' | 'http'

/**
 * A server definition. It never carries a secret: `envSchema` maps the environment variable a server reads to the
 * CipherGate secret name that should fill it, and a credential answers that map. One server, many credentials.
 */
export interface McpServer {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly transport: McpTransport
  readonly command: string | null
  readonly args: readonly string[]
  readonly url: string | null
  readonly envSchema: Readonly<Record<string, string>>
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface McpServerInput {
  readonly name: string
  readonly description?: string
  readonly transport: McpTransport
  readonly command?: string | null
  readonly args?: readonly string[]
  readonly url?: string | null
  readonly envSchema?: Readonly<Record<string, string>>
}

export type McpServerPatch = Partial<Omit<McpServerInput, 'transport'>> & {
  readonly transport?: McpTransport
}

/** A named set of CipherGate references for one server. `consumer` scopes the bearer key; `secretMap` names the values. */
export interface McpCredential {
  readonly id: string
  readonly mcpServerId: string
  readonly label: string
  readonly consumer: string
  readonly secretMap: Readonly<Record<string, string>>
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface McpCredentialInput {
  readonly label: string
  readonly consumer: string
  readonly secretMap?: Readonly<Record<string, string>>
}

export type McpCredentialPatch = Partial<McpCredentialInput>

interface McpServerRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly transport: McpTransport
  readonly command: string | null
  readonly args: string[]
  readonly url: string | null
  readonly env_schema: unknown
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

interface McpCredentialRow {
  readonly id: string
  readonly mcp_server_id: string
  readonly label: string
  readonly consumer: string
  readonly secret_map: unknown
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

const SERVER_COLUMNS =
  'id, name, description, transport, command, args, url, env_schema, archived_at, created_at, updated_at'
const CREDENTIAL_COLUMNS =
  'id, mcp_server_id, label, consumer, secret_map, archived_at, created_at, updated_at'

/** A jsonb column read back into a string map: anything else in the column was not written by this module. */
const toMapping = (value: unknown): Readonly<Record<string, string>> => {
  if (typeof value !== 'object' || value === null) return {}

  const pairs = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )

  return Object.fromEntries(pairs)
}

const toServer = (row: McpServerRow): McpServer => ({
  id: row.id,
  name: row.name,
  description: row.description,
  transport: row.transport,
  command: row.command,
  args: row.args,
  url: row.url,
  envSchema: toMapping(row.env_schema),
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toCredential = (row: McpCredentialRow): McpCredential => ({
  id: row.id,
  mcpServerId: row.mcp_server_id,
  label: row.label,
  consumer: row.consumer,
  secretMap: toMapping(row.secret_map),
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const visibleClause = (archived: boolean | undefined): string =>
  archived === true ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'

const notFound = (what: string): AppError =>
  new AppError(`the ${what} does not exist`, { statusCode: 404, code: 'MCP_NOT_FOUND' })

/** The unique index on the name is the one constraint a writer can trip, and it deserves a stable code. */
const NAME_TAKEN = '23505'

const rethrow = (error: unknown, message: string): never => {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === NAME_TAKEN) {
    throw new AppError(message, { statusCode: 409, code: 'NAME_TAKEN' })
  }

  throw error instanceof Error ? error : new Error(String(error))
}

/** Reads and writes `mcp_servers`: what to launch and what the environment must contain, never the values. */
export class McpServerRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema
  // Fixed statements live beside the columns they name, so a call site binds only ids.
  readonly #delete: string
  readonly #hasCredentials: string

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema
    this.#delete = `DELETE FROM ${schema.tables.mcpServers} WHERE id = $1`
    this.#hasCredentials = `SELECT 1 FROM ${schema.tables.mcpCredentials} WHERE mcp_server_id = $1 LIMIT 1`
  }

  async list(ownerId: string, options: { archived?: boolean | undefined } = {}): Promise<McpServer[]> {
    const text = `SELECT ${SERVER_COLUMNS} FROM ${this.#schema.tables.mcpServers}
      WHERE owner_id = $1 AND ${visibleClause(options.archived)} ORDER BY name`

    return (await this.#pool.query<McpServerRow>(text, [ownerId])).rows.map(toServer)
  }

  async find(id: string): Promise<McpServer | undefined> {
    const text = `SELECT ${SERVER_COLUMNS} FROM ${this.#schema.tables.mcpServers} WHERE id = $1`

    return (await this.#pool.query<McpServerRow>(text, [id])).rows.map(toServer)[0]
  }

  async create(ownerId: string, input: McpServerInput): Promise<McpServer> {
    const text = `INSERT INTO ${this.#schema.tables.mcpServers}
      (id, owner_id, name, description, transport, command, args, url, env_schema)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${SERVER_COLUMNS}`
    const values: Value[] = [
      randomUUID(),
      ownerId,
      input.name,
      input.description ?? '',
      input.transport,
      input.command ?? null,
      [...(input.args ?? [])],
      input.url ?? null,
      JSON.stringify(input.envSchema ?? {}),
    ]

    try {
      return toServer(await this.#insert(text, values))
    } catch (error) {
      return rethrow(error, 'an MCP server with that name already exists')
    }
  }

  async update(id: string, patch: McpServerPatch): Promise<McpServer> {
    const assignments: string[] = []
    const values: Value[] = [id]
    const bind = (column: string, value: Value): void => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }
    if (patch.name !== undefined) bind('name', patch.name)
    if (patch.description !== undefined) bind('description', patch.description)
    if (patch.transport !== undefined) bind('transport', patch.transport)
    if (patch.command !== undefined) bind('command', patch.command)
    if (patch.args !== undefined) bind('args', [...patch.args])
    if (patch.url !== undefined) bind('url', patch.url)
    if (patch.envSchema !== undefined) bind('env_schema', JSON.stringify(patch.envSchema))
    if (assignments.length === 0) return await this.#require(id)

    assignments.push('updated_at = now()')
    const text = `UPDATE ${this.#schema.tables.mcpServers} SET ${assignments.join(', ')}
      WHERE id = $1 RETURNING ${SERVER_COLUMNS}`

    try {
      return toServer(await this.#insert(text, values))
    } catch (error) {
      return rethrow(error, 'an MCP server with that name already exists')
    }
  }

  async archive(id: string): Promise<McpServer> {
    const text = `UPDATE ${this.#schema.tables.mcpServers} SET archived_at = now(), updated_at = now()
      WHERE id = $1 RETURNING ${SERVER_COLUMNS}`

    return toServer(await this.#insert(text, [id]))
  }

  async restore(id: string): Promise<McpServer> {
    const text = `UPDATE ${this.#schema.tables.mcpServers} SET archived_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING ${SERVER_COLUMNS}`

    return toServer(await this.#insert(text, [id]))
  }

  /** A server with credentials still on it is archived, not deleted: the credentials and every grant point at it. */
  async delete(id: string): Promise<void> {
    if ((await this.#pool.query(this.#hasCredentials, [id])).rows.length > 0) {
      throw new AppError('the MCP server still has credentials', { statusCode: 409, code: 'CAPABILITY_IN_USE' })
    }

    await this.#pool.query(this.#delete, [id])
  }

  async #require(id: string): Promise<McpServer> {
    const found = await this.find(id)
    if (found === undefined) throw notFound('MCP server')

    return found
  }

  async #insert(text: string, values: readonly Value[]): Promise<McpServerRow> {
    const { rows } = await this.#pool.query<McpServerRow>(text, [...values])
    const row = rows[0]
    if (row === undefined) throw notFound('MCP server')

    return row
  }
}

/** Reads and writes `mcp_credentials`: a label, a consumer and which secret fills which variable. Never a value. */
export class McpCredentialRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema
  readonly #delete: string
  readonly #granted: string

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema
    this.#delete = `DELETE FROM ${schema.tables.mcpCredentials} WHERE id = $1`
    this.#granted = `SELECT 1 FROM ${schema.tables.workspaceMcpCredentials} WHERE credential_id = $1
      UNION ALL SELECT 1 FROM ${schema.tables.workspaceMcpServers} WHERE default_credential_id = $1
      UNION ALL SELECT 1 FROM ${schema.tables.agentMcpServers} WHERE credential_id = $1 LIMIT 1`
  }

  async list(
    serverId: string,
    options: { archived?: boolean | undefined } = {},
  ): Promise<McpCredential[]> {
    const text = `SELECT ${CREDENTIAL_COLUMNS} FROM ${this.#schema.tables.mcpCredentials}
      WHERE mcp_server_id = $1 AND ${visibleClause(options.archived)} ORDER BY label`

    return (await this.#pool.query<McpCredentialRow>(text, [serverId])).rows.map(toCredential)
  }

  async find(id: string): Promise<McpCredential | undefined> {
    const text = `SELECT ${CREDENTIAL_COLUMNS} FROM ${this.#schema.tables.mcpCredentials} WHERE id = $1`

    return (await this.#pool.query<McpCredentialRow>(text, [id])).rows.map(toCredential)[0]
  }

  async create(ownerId: string, serverId: string, input: McpCredentialInput): Promise<McpCredential> {
    const text = `INSERT INTO ${this.#schema.tables.mcpCredentials}
      (id, mcp_server_id, owner_id, label, consumer, secret_map)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${CREDENTIAL_COLUMNS}`
    const values: Value[] = [
      randomUUID(),
      serverId,
      ownerId,
      input.label,
      input.consumer,
      JSON.stringify(input.secretMap ?? {}),
    ]

    try {
      return toCredential(await this.#insert(text, values))
    } catch (error) {
      return rethrow(error, 'a credential with that label already exists for this server')
    }
  }

  async update(id: string, patch: McpCredentialPatch): Promise<McpCredential> {
    const assignments: string[] = []
    const values: Value[] = [id]
    const bind = (column: string, value: Value): void => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }
    if (patch.label !== undefined) bind('label', patch.label)
    if (patch.consumer !== undefined) bind('consumer', patch.consumer)
    if (patch.secretMap !== undefined) bind('secret_map', JSON.stringify(patch.secretMap))
    if (assignments.length === 0) {
      const found = await this.find(id)
      if (found === undefined) throw notFound('credential')

      return found
    }

    assignments.push('updated_at = now()')
    const text = `UPDATE ${this.#schema.tables.mcpCredentials} SET ${assignments.join(', ')}
      WHERE id = $1 RETURNING ${CREDENTIAL_COLUMNS}`

    try {
      return toCredential(await this.#insert(text, values))
    } catch (error) {
      return rethrow(error, 'a credential with that label already exists for this server')
    }
  }

  async archive(id: string): Promise<McpCredential> {
    const text = `UPDATE ${this.#schema.tables.mcpCredentials} SET archived_at = now(), updated_at = now()
      WHERE id = $1 RETURNING ${CREDENTIAL_COLUMNS}`

    return toCredential(await this.#insert(text, [id]))
  }

  async restore(id: string): Promise<McpCredential> {
    const text = `UPDATE ${this.#schema.tables.mcpCredentials} SET archived_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING ${CREDENTIAL_COLUMNS}`

    return toCredential(await this.#insert(text, [id]))
  }

  /** Refused while a workspace or an agent still names it: an agent that lost its credential would run unauthenticated. */
  async delete(id: string): Promise<void> {
    if ((await this.#pool.query(this.#granted, [id])).rows.length > 0) {
      throw new AppError('the credential is still granted somewhere', {
        statusCode: 409,
        code: 'CAPABILITY_IN_USE',
      })
    }

    await this.#pool.query(this.#delete, [id])
  }

  async #insert(text: string, values: readonly Value[]): Promise<McpCredentialRow> {
    const { rows } = await this.#pool.query<McpCredentialRow>(text, [...values])
    const row = rows[0]
    if (row === undefined) throw notFound('credential')

    return row
  }
}
