import { randomUUID } from 'node:crypto'

import type { Pool, QueryResultRow } from 'pg'

import { AppError } from '../errors.js'
import type { Value } from '../storage/postgres/db.js'
import { rowsOf, withClient, withTransaction } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/** How hard the model reasons, in pi-ai's names. `low` is what an agent starts with. */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/**
 * One profile inside a workspace: the text that steers a conversation and whether it reaches every available tool.
 * Which tools, skills and MCP servers it selected lives in the link tables, because
 * those are references to catalog rows rather than names a profile could carry as text.
 */
export interface AgentProfile {
  readonly id: string
  readonly workspaceId: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
  readonly allowAll: boolean
  readonly systemPrompt: string
  readonly instructions: string
  /** The stored key the agent runs with, or `null` to use the one its workspace links. */
  readonly credentialId: string | null
  /** The model id within the provider, or `null` for the platform default. */
  readonly modelId: string | null
  readonly thinkingLevel: ThinkingLevel
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface AgentInput {
  readonly name: string
  readonly description?: string
  readonly allowAll?: boolean
  readonly systemPrompt?: string
  readonly instructions?: string
  readonly credentialId?: string | null
  readonly modelId?: string | null
  readonly thinkingLevel?: ThinkingLevel
}

export type AgentPatch = Partial<AgentInput>

interface AgentRow {
  readonly id: string
  readonly workspace_id: string
  readonly name: string
  readonly description: string
  readonly is_default: boolean
  readonly allow_all: boolean
  readonly system_prompt: string
  readonly instructions: string
  readonly credential_id: string | null
  readonly model_id: string | null
  readonly thinking_level: ThinkingLevel
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

interface WorkspaceRow {
  readonly archived_at: Date | null
}

const toAgent = (row: AgentRow): AgentProfile => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  description: row.description,
  isDefault: row.is_default,
  allowAll: row.allow_all,
  systemPrompt: row.system_prompt,
  instructions: row.instructions,
  credentialId: row.credential_id,
  modelId: row.model_id,
  thinkingLevel: row.thinking_level,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const COLUMNS = `id, workspace_id, name, description, is_default, allow_all,
  system_prompt, instructions, credential_id, model_id, thinking_level, archived_at, created_at, updated_at`

const immutable = (): AppError =>
  new AppError('the default agent cannot be archived or deleted', {
    statusCode: 403,
    code: 'AGENT_IMMUTABLE',
  })

const inUse = (): AppError =>
  new AppError('the agent still has live threads', { statusCode: 409, code: 'AGENT_IN_USE' })

const notArchived = (): AppError =>
  new AppError('archive the agent before deleting it', {
    statusCode: 409,
    code: 'AGENT_NOT_ARCHIVED',
  })

const workspaceArchived = (): AppError =>
  new AppError('the workspace is archived', { statusCode: 409, code: 'WORKSPACE_ARCHIVED' })

/** Reads and writes `agents`, enforcing the ceiling of the workspace each agent belongs to. */
export class AgentRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema
  // Statements whose text is not a value of this call live beside the columns they name, so the call sites bind only ids.
  readonly #sql: {
    readonly archive: string
    readonly archiveThreads: string
    readonly deleteThreads: string
    readonly deleteAgent: string
  }

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema

    const { tables } = schema
    const stamp = 'archived_at = now(), updated_at = now()'
    this.#sql = {
      archive: `UPDATE ${tables.agents} SET ${stamp} WHERE id = $1`,
      archiveThreads: `UPDATE ${tables.chatThreads} SET ${stamp} WHERE agent_id = $1 AND archived_at IS NULL`,
      deleteThreads: `DELETE FROM ${tables.chatThreads} WHERE agent_id = $1`,
      deleteAgent: `DELETE FROM ${tables.agents} WHERE id = $1`,
    }
  }

  /** The agents of one workspace: the live ones, or the archived ones when asked for. */
  async list(
    workspaceId: string,
    options: { archived?: boolean | undefined } = {},
  ): Promise<AgentProfile[]> {
    const visible = options.archived === true ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.agents}
      WHERE workspace_id = $1 AND ${visible} ORDER BY name`

    return (await this.#select(text, [workspaceId])).map(toAgent)
  }

  /** The agent a new thread gets when it names none. Seeded with the workspace, so it exists whenever the one does. */
  async default(workspaceId: string): Promise<AgentProfile | undefined> {
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.agents}
      WHERE workspace_id = $1 AND is_default AND archived_at IS NULL`

    return this.#one(text, [workspaceId])
  }

  async find(id: string): Promise<AgentProfile | undefined> {
    return this.#one(`SELECT ${COLUMNS} FROM ${this.#schema.tables.agents} WHERE id = $1`, [id])
  }

  async create(workspaceId: string, input: AgentInput): Promise<AgentProfile> {
    await this.#assertWorkspaceOpen(workspaceId)

    const text = `INSERT INTO ${this.#schema.tables.agents}
      (id, workspace_id, name, description, allow_all, system_prompt, instructions, credential_id, model_id,
       thinking_level)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${COLUMNS}`
    const rows = await this.#select(text, [
      randomUUID(),
      workspaceId,
      input.name,
      input.description ?? '',
      // An agent is created with everything enabled and the user narrows it, so a profile left alone is general-purpose.
      input.allowAll ?? true,
      input.systemPrompt ?? '',
      input.instructions ?? '',
      input.credentialId ?? null,
      input.modelId ?? null,
      input.thinkingLevel ?? 'low',
    ])
    const row = rows[0]
    if (row === undefined) throw new Error('The agent insert returned no row')

    return toAgent(row)
  }

  /**
   * Edit an agent, or answer `undefined` when the id is unknown. The default agent is edited like any other (it needs a
   * key and a model as much as any agent does); only archiving and deleting it are refused.
   */
  async update(id: string, patch: AgentPatch): Promise<AgentProfile | undefined> {
    const existing = await this.find(id)
    if (existing === undefined) return undefined
    // An archived workspace files its agents with it, so an edit now would land somewhere nobody is looking.
    await this.#assertWorkspaceOpen(existing.workspaceId)

    const assignments: string[] = []
    const values: Value[] = []
    const assign = (column: string, value: Value): void => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }

    if (patch.name !== undefined) assign('name', patch.name)
    if (patch.description !== undefined) assign('description', patch.description)
    if (patch.allowAll !== undefined) assign('allow_all', patch.allowAll)
    if (patch.systemPrompt !== undefined) assign('system_prompt', patch.systemPrompt)
    if (patch.instructions !== undefined) assign('instructions', patch.instructions)
    if (patch.credentialId !== undefined) assign('credential_id', patch.credentialId)
    if (patch.modelId !== undefined) assign('model_id', patch.modelId)
    if (patch.thinkingLevel !== undefined) assign('thinking_level', patch.thinkingLevel)
    if (assignments.length === 0) return existing

    values.push(id)
    const text = `UPDATE ${this.#schema.tables.agents} SET ${assignments.join(', ')}, updated_at = now()
      WHERE id = $${values.length} RETURNING ${COLUMNS}`

    return this.#one(text, values)
  }

  /**
   * Archive an agent together with its threads, in one transaction: the agent is what those threads run, so leaving
   * them live would offer conversations that cannot answer. Idempotent, and `undefined` only when the id is unknown.
   */
  async archive(id: string): Promise<AgentProfile | undefined> {
    const existing = await this.find(id)
    if (existing === undefined) return undefined
    if (existing.isDefault) throw immutable()
    if (existing.archivedAt !== null) return existing

    await withTransaction(this.#pool, async (client) => {
      await client.query(this.#sql.archive, [id])
      await client.query(this.#sql.archiveThreads, [id])
    })

    return this.find(id)
  }

  /** Lift the archive from this agent alone; its threads stay archived unless each one is restored. */
  async restore(id: string): Promise<AgentProfile | undefined> {
    const existing = await this.find(id)
    if (existing === undefined) return undefined
    if (existing.isDefault) throw immutable()
    if (existing.archivedAt === null) return existing

    const text = `UPDATE ${this.#schema.tables.agents} SET archived_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`

    return this.#one(text, [id])
  }

  /**
   * Delete an archived agent together with its archived threads. Deleting is the second half of archiving, so a live
   * agent is refused, and so is one holding a thread that was restored on its own.
   */
  async remove(id: string): Promise<boolean> {
    const existing = await this.find(id)
    if (existing === undefined) return false
    if (existing.isDefault) throw immutable()
    if (existing.archivedAt === null) throw notArchived()

    const live = await this.#select(
      `SELECT id FROM ${this.#schema.tables.chatThreads} WHERE agent_id = $1 AND archived_at IS NULL LIMIT 1`,
      [id],
    )
    if (live.length > 0) throw inUse()

    await withTransaction(this.#pool, async (client) => {
      await client.query(this.#sql.deleteThreads, [id])
      await client.query(this.#sql.deleteAgent, [id])
    })

    return true
  }

  /** A workspace that is missing or archived cannot take a new agent; `CapabilityLinks` owns what it may reach. */
  async #assertWorkspaceOpen(workspaceId: string): Promise<void> {
    const text = `SELECT archived_at FROM ${this.#schema.tables.workspaces} WHERE id = $1`
    const rows = await this.#select<WorkspaceRow>(text, [workspaceId])
    const row = rows[0]
    if (row === undefined) {
      throw new AppError('the workspace does not exist', {
        statusCode: 404,
        code: 'WORKSPACE_NOT_FOUND',
      })
    }
    // An archived workspace is read-only: its agents are archived with it, so adding one would file it out of sight.
    if (row.archived_at !== null) throw workspaceArchived()
  }

  async #one(text: string, values: readonly Value[]): Promise<AgentProfile | undefined> {
    const rows = await this.#select(text, values)

    return rows[0] === undefined ? undefined : toAgent(rows[0])
  }

  async #select<R extends QueryResultRow = AgentRow>(
    text: string,
    values: readonly Value[],
  ): Promise<R[]> {
    return withClient(this.#pool, (client) => rowsOf<R>(client, text, values))
  }
}
