import { randomUUID } from 'node:crypto'

import type { Pool, QueryResultRow } from 'pg'

import { AgentRepository } from '../agents/agent-repository.js'
import type { ThinkingLevel } from '../agents/agent-repository.js'
import { AppError } from '../errors.js'
import type { Value } from '../storage/postgres/db.js'
import { rowsOf, withClient, withTransaction } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

export interface SubagentProfile {
  readonly id: string
  readonly workspaceId: string
  readonly name: string
  readonly description: string
  readonly allowAll: boolean
  readonly systemPromptAppend: string
  readonly instructions: string
  readonly credentialId: string | null
  /** The model a delegation uses unless its parent deliberately selects another allowed model. */
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
  readonly allowedModels: readonly string[]
  readonly callableBy: readonly string[]
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface SubagentInput {
  readonly name: string
  readonly description?: string
  readonly allowAll?: boolean
  readonly systemPromptAppend?: string
  readonly instructions?: string
  readonly credentialId?: string | null
  readonly modelId: string
  readonly thinkingLevel?: ThinkingLevel
  readonly allowedModels: readonly string[]
  readonly callableBy?: readonly string[]
}

export type SubagentPatch = Partial<SubagentInput>

interface SubagentRow extends QueryResultRow {
  readonly id: string
  readonly workspace_id: string
  readonly name: string
  readonly description: string
  readonly allow_all: boolean
  readonly system_prompt_append: string
  readonly instructions: string
  readonly credential_id: string | null
  readonly model_id: string
  readonly thinking_level: ThinkingLevel
  readonly allowed_models: string[]
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

const COLUMNS = `id, workspace_id, name, description, allow_all, system_prompt_append, instructions,
  credential_id, model_id, thinking_level, allowed_models, archived_at, created_at, updated_at`

const toSubagent = (row: SubagentRow, callableBy: readonly string[]): SubagentProfile => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  description: row.description,
  allowAll: row.allow_all,
  systemPromptAppend: row.system_prompt_append,
  instructions: row.instructions,
  credentialId: row.credential_id,
  modelId: row.model_id,
  thinkingLevel: row.thinking_level,
  allowedModels: row.allowed_models,
  callableBy,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** Everything the parent needs to choose a sub agent and, only with good reason, a non-default model. */
export interface CallableSubagent {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
  readonly allowedModels: readonly string[]
}

/** Sub agents are agent rows so the existing tool, skill, MCP and environment grant links apply unchanged. */
export class SubagentRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema
  readonly #agents: AgentRepository

  constructor(pool: Pool, schema: PostgresSchema, agents = new AgentRepository(pool, schema)) {
    this.#pool = pool
    this.#schema = schema
    this.#agents = agents
  }

  async list(workspaceId: string, options: { archived?: boolean | undefined } = {}): Promise<SubagentProfile[]> {
    const visible = options.archived === true ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'
    const rows = await this.#select(
      `SELECT ${COLUMNS} FROM ${this.#schema.tables.agents}
       WHERE workspace_id = $1 AND kind = 'subagent' AND ${visible} ORDER BY name`,
      [workspaceId],
    )

    return Promise.all(rows.map(async (row) => toSubagent(row, await this.callers(row.id))))
  }

  async find(id: string): Promise<SubagentProfile | undefined> {
    const rows = await this.#select(
      `SELECT ${COLUMNS} FROM ${this.#schema.tables.agents} WHERE id = $1 AND kind = 'subagent'`,
      [id],
    )
    const row = rows[0]

    return row === undefined ? undefined : toSubagent(row, await this.callers(id))
  }

  async create(workspaceId: string, input: SubagentInput): Promise<SubagentProfile> {
    await this.#assertWorkspaceOpen(workspaceId)
    const callableBy = input.callableBy ?? []
    await this.#assertCallers(workspaceId, callableBy)
    const id = randomUUID()
    await this.#select(
      `INSERT INTO ${this.#schema.tables.agents}
        (id, workspace_id, kind, name, description, allow_all, system_prompt_append, instructions,
         credential_id, model_id, thinking_level, allowed_models)
       VALUES ($1, $2, 'subagent', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        workspaceId,
        input.name,
        input.description ?? '',
        input.allowAll ?? true,
        input.systemPromptAppend ?? '',
        input.instructions ?? '',
        input.credentialId ?? null,
        input.modelId,
        input.thinkingLevel ?? 'low',
        [...input.allowedModels],
      ],
    )
    await this.#replaceCallers(id, callableBy)
    const created = await this.find(id)
    if (created === undefined) throw new Error('The sub agent insert returned no row')

    return created
  }

  async update(id: string, patch: SubagentPatch): Promise<SubagentProfile | undefined> {
    const existing = await this.find(id)
    if (existing === undefined) return undefined
    await this.#assertWorkspaceOpen(existing.workspaceId)
    if (patch.callableBy !== undefined) await this.#assertCallers(existing.workspaceId, patch.callableBy)

    const assignments: string[] = []
    const values: Value[] = []
    const assign = (column: string, value: Value): void => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }
    if (patch.name !== undefined) assign('name', patch.name)
    if (patch.description !== undefined) assign('description', patch.description)
    if (patch.allowAll !== undefined) assign('allow_all', patch.allowAll)
    if (patch.systemPromptAppend !== undefined) assign('system_prompt_append', patch.systemPromptAppend)
    if (patch.instructions !== undefined) assign('instructions', patch.instructions)
    if (patch.credentialId !== undefined) assign('credential_id', patch.credentialId)
    if (patch.modelId !== undefined) assign('model_id', patch.modelId)
    if (patch.thinkingLevel !== undefined) assign('thinking_level', patch.thinkingLevel)
    if (patch.allowedModels !== undefined) assign('allowed_models', [...patch.allowedModels])

    if (assignments.length > 0) {
      values.push(id)
      await this.#select(
        `UPDATE ${this.#schema.tables.agents} SET ${assignments.join(', ')}, updated_at = now()
         WHERE id = $${values.length} AND kind = 'subagent'`,
        values,
      )
    }
    if (patch.callableBy !== undefined) await this.#replaceCallers(id, patch.callableBy)

    return this.find(id)
  }

  async archive(id: string): Promise<SubagentProfile | undefined> {
    if ((await this.find(id)) === undefined) return undefined
    await this.#agents.archive(id)

    return this.find(id)
  }

  async restore(id: string): Promise<SubagentProfile | undefined> {
    if ((await this.find(id)) === undefined) return undefined
    await this.#agents.restore(id)

    return this.find(id)
  }

  async remove(id: string): Promise<boolean> {
    if ((await this.find(id)) === undefined) return false
    const used = await this.#select<{ id: string }>(
      `SELECT id FROM ${this.#schema.tables.delegations} WHERE subagent_id = $1 LIMIT 1`,
      [id],
    )
    if (used.length > 0) {
      throw new AppError('a sub agent with delegation history cannot be deleted', {
        statusCode: 409,
        code: 'SUBAGENT_IN_USE',
      })
    }

    return this.#agents.remove(id)
  }

  async callers(subagentId: string): Promise<string[]> {
    const rows = await this.#select<{ agent_id: string }>(
      `SELECT agent_id FROM ${this.#schema.tables.subagentCallers} WHERE subagent_id = $1 ORDER BY agent_id`,
      [subagentId],
    )

    return rows.map((row) => row.agent_id)
  }

  /** Live sub agents one ordinary agent may call, with the model choices rendered into its per-turn prompt. */
  async callableBy(agentId: string): Promise<CallableSubagent[]> {
    const rows = await this.#select<CallableSubagentRow>(
      `SELECT s.id, s.name, s.description, s.model_id, s.thinking_level, s.allowed_models
       FROM ${this.#schema.tables.subagentCallers} c
       JOIN ${this.#schema.tables.agents} s ON s.id = c.subagent_id
       JOIN ${this.#schema.tables.agents} a ON a.id = c.agent_id
       WHERE c.agent_id = $1 AND s.kind = 'subagent' AND s.archived_at IS NULL
         AND a.kind = 'agent' AND a.archived_at IS NULL
       ORDER BY s.name`,
      [agentId],
    )

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      modelId: row.model_id,
      thinkingLevel: row.thinking_level,
      allowedModels: row.allowed_models,
    }))
  }

  async #replaceCallers(subagentId: string, callers: readonly string[]): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      await client.query(`DELETE FROM ${this.#schema.tables.subagentCallers} WHERE subagent_id = $1`, [subagentId])
      for (const agentId of new Set(callers)) {
        await client.query(
          `INSERT INTO ${this.#schema.tables.subagentCallers} (subagent_id, agent_id) VALUES ($1, $2)`,
          [subagentId, agentId],
        )
      }
    })
  }

  async #assertCallers(workspaceId: string, callers: readonly string[]): Promise<void> {
    for (const id of new Set(callers)) {
      const caller = await this.#agents.find(id)
      if (caller?.kind === 'agent' && caller.workspaceId === workspaceId && caller.archivedAt === null) continue

      throw new AppError('callableBy must name live agents of the same workspace', {
        statusCode: 400,
        code: 'SUBAGENT_CALLER_INVALID',
      })
    }
  }

  async #assertWorkspaceOpen(id: string): Promise<void> {
    const rows = await this.#select<{ archived_at: Date | null }>(
      `SELECT archived_at FROM ${this.#schema.tables.workspaces} WHERE id = $1`,
      [id],
    )
    const workspace = rows[0]
    if (workspace === undefined) {
      throw new AppError('the workspace does not exist', { statusCode: 404, code: 'WORKSPACE_NOT_FOUND' })
    }
    if (workspace.archived_at !== null) {
      throw new AppError('the workspace is archived', { statusCode: 409, code: 'WORKSPACE_ARCHIVED' })
    }
  }

  async #select<R extends QueryResultRow = SubagentRow>(text: string, values: readonly Value[]): Promise<R[]> {
    return withClient(this.#pool, (client) => rowsOf<R>(client, text, values))
  }
}

interface CallableSubagentRow extends QueryResultRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly model_id: string
  readonly thinking_level: ThinkingLevel
  readonly allowed_models: string[]
}
