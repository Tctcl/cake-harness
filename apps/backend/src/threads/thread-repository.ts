import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import type { RunSettingsOverrides, RunSettingsPatch } from '../agents/run-settings.js'
import type { ThinkingLevel } from '../agents/agent-repository.js'
import { AppError } from '../errors.js'
import type { Value } from '../storage/postgres/db.js'
import { rowsOf, withClient } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/**
 * A chat thread as the product sees it. It carries no messages: the transcript lives in the durable log, and this row
 * only says who owns the conversation, what to call it, and which conversation that is.
 */
export interface ChatThread {
  readonly id: string
  readonly title: string | null
  readonly workspaceId: string
  readonly agentId: string
  readonly durableConversationId: number
  readonly overrides: RunSettingsOverrides
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** Which threads a listing covers. The live ones unless archiving is asked for. */
export interface ThreadListOptions {
  readonly workspaceId?: string | undefined
  readonly archived?: boolean | undefined
}

interface ThreadRow {
  readonly id: string
  readonly title: string | null
  readonly workspace_id: string
  readonly agent_id: string
  readonly durable_conversation_id: string
  readonly credential_id: string | null
  readonly model_id: string | null
  readonly thinking_level: ThinkingLevel | null
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

// `durable_conversation_id` is `bigint`, which node-postgres hands back as a string: it refuses to guess whether a value
// beyond 2^53 would survive a `number`. Ours are dentable conversation ids, so the cast is the honest one.
const toThread = (row: ThreadRow): ChatThread => ({
  id: row.id,
  title: row.title,
  workspaceId: row.workspace_id,
  agentId: row.agent_id,
  durableConversationId: Number(row.durable_conversation_id),
  overrides: {
    credentialId: row.credential_id,
    modelId: row.model_id,
    thinkingLevel: row.thinking_level,
  },
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const COLUMNS = `id, title, workspace_id, agent_id, durable_conversation_id,
  credential_id, model_id, thinking_level, archived_at, created_at, updated_at`

const notArchived = (): AppError =>
  new AppError('archive the thread before deleting it', {
    statusCode: 409,
    code: 'THREAD_NOT_ARCHIVED',
  })

/** The workspace and agent a new thread belongs to; both rows must already exist. */
export interface ThreadTarget {
  readonly workspaceId: string
  readonly agentId: string
}

/** Reads and writes `chat_threads` over the pool the durable storage already owns. */
export class ThreadRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema
  }

  /** Threads of `ownerId`, most recently changed first: the live ones, or the archived ones when `archived` asks. */
  async list(ownerId: string, options: ThreadListOptions = {}): Promise<ChatThread[]> {
    const values: Value[] = [ownerId]
    const where = ['owner_id = $1']
    if (options.workspaceId !== undefined) {
      values.push(options.workspaceId)
      where.push(`workspace_id = $${values.length}`)
    }
    where.push(options.archived === true ? 'archived_at IS NOT NULL' : 'archived_at IS NULL')

    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.chatThreads}
      WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`

    return (await this.#select(text, values)).map(toThread)
  }

  /** One thread, or `undefined` when the id is unknown. */
  async find(id: string): Promise<ChatThread | undefined> {
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.chatThreads} WHERE id = $1`
    const rows = await this.#select(text, [id])

    return rows[0] === undefined ? undefined : toThread(rows[0])
  }

  /**
   * Record a thread for a conversation the durable log has already created. The id is minted here: the conversation is
   * what has to exist first, so its creator has nothing to name the row with until it returns.
   */
  async create(
    ownerId: string,
    durableConversationId: number,
    target: ThreadTarget,
    title: string | null = null,
  ): Promise<ChatThread> {
    const text = `INSERT INTO ${this.#schema.tables.chatThreads}
      (id, owner_id, workspace_id, agent_id, title, durable_conversation_id)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`
    const rows = await this.#select(text, [
      randomUUID(),
      ownerId,
      target.workspaceId,
      target.agentId,
      title,
      durableConversationId,
    ])
    const row = rows[0]
    if (row === undefined) throw new Error('The chat thread insert returned no row')

    return toThread(row)
  }

  /** Change only the fields the patch names; null hands that setting back to the thread's agent. */
  async updateRunSettings(id: string, patch: RunSettingsPatch): Promise<ChatThread | undefined> {
    const existing = await this.find(id)
    if (existing === undefined) return undefined

    const assignments: string[] = []
    const values: Value[] = []
    const assign = (column: string, value: Value): void => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }

    if (patch.credentialId !== undefined) assign('credential_id', patch.credentialId)
    if (patch.modelId !== undefined) assign('model_id', patch.modelId)
    if (patch.thinkingLevel !== undefined) assign('thinking_level', patch.thinkingLevel)
    if (assignments.length === 0) return existing

    values.push(id)
    const text = `UPDATE ${this.#schema.tables.chatThreads} SET ${assignments.join(', ')}, updated_at = now()
      WHERE id = $${values.length} RETURNING ${COLUMNS}`
    const rows = await this.#select(text, values)

    return rows[0] === undefined ? undefined : toThread(rows[0])
  }

  /** Rename a thread, or answer `undefined` when the id is unknown. */
  async rename(id: string, title: string | null): Promise<ChatThread | undefined> {
    const text = `UPDATE ${this.#schema.tables.chatThreads} SET title = $2, updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`
    const rows = await this.#select(text, [id, title])

    return rows[0] === undefined ? undefined : toThread(rows[0])
  }

  /**
   * Archive a thread: the row and its transcript stay, the listing stops showing them. Idempotent, and `undefined` only
   * when the id is unknown.
   */
  async archive(id: string): Promise<ChatThread | undefined> {
    return this.#settled(id, 'archived_at IS NULL', 'archived_at = now()')
  }

  /** Lift the archive from this thread alone; a thread comes back even while its workspace stays archived. */
  async restore(id: string): Promise<ChatThread | undefined> {
    return this.#settled(id, 'archived_at IS NOT NULL', 'archived_at = NULL')
  }

  /** Delete an archived thread row and answer whether one existed. The durable conversation is not touched. */
  async remove(id: string): Promise<boolean> {
    const existing = await this.find(id)
    if (existing === undefined) return false
    // Deleting is the second half of archiving: a live thread is never removed by one request.
    if (existing.archivedAt === null) throw notArchived()

    const text = `DELETE FROM ${this.#schema.tables.chatThreads} WHERE id = $1 RETURNING id`

    return (await this.#select(text, [id])).length > 0
  }

  /** Move `id` between archived and live, answering the row either way; the guard makes a repeat a no-op. */
  async #settled(id: string, guard: string, assignment: string): Promise<ChatThread | undefined> {
    const text = `UPDATE ${this.#schema.tables.chatThreads} SET ${assignment}, updated_at = now()
      WHERE id = $1 AND ${guard} RETURNING ${COLUMNS}`
    const rows = await this.#select(text, [id])

    return rows[0] === undefined ? this.find(id) : toThread(rows[0])
  }

  async #select(text: string, values: readonly Value[]): Promise<ThreadRow[]> {
    return withClient(this.#pool, (client) => rowsOf<ThreadRow>(client, text, values))
  }
}
