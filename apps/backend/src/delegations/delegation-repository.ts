import type { Pool, QueryResultRow } from 'pg'

import type { Value } from '../storage/postgres/db.js'
import { rowsOf, withClient } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

export type DelegationStatus = 'running' | 'done' | 'failed'

export interface DelegationRecord {
  readonly id: string
  readonly parentThreadId: string
  readonly parentConversationId: number
  readonly parentTaskId: number
  readonly parentCallId: string
  readonly subagentId: string
  readonly subagentName: string
  readonly childConversationId: number
  readonly status: DelegationStatus
  readonly worktreePath: string | null
  readonly worktreeBranch: string | null
  readonly resultSummary: string | null
  readonly startedAt: Date
  readonly finishedAt: Date | null
}

export interface StartDelegation {
  readonly id: string
  readonly parentThreadId: string
  readonly parentConversationId: number
  readonly parentTaskId: number
  readonly parentCallId: string
  readonly subagentId: string
  readonly childConversationId: number
  readonly worktreePath: string | null
  readonly worktreeBranch: string | null
}

interface DelegationRow extends QueryResultRow {
  readonly id: string
  readonly parent_thread_id: string
  readonly parent_conversation_id: string
  readonly parent_task_id: string
  readonly parent_call_id: string
  readonly subagent_id: string
  readonly subagent_name: string
  readonly child_conversation_id: string
  readonly status: DelegationStatus
  readonly worktree_path: string | null
  readonly worktree_branch: string | null
  readonly result_summary: string | null
  readonly started_at: Date
  readonly finished_at: Date | null
}

const toDelegation = (row: DelegationRow): DelegationRecord => ({
  id: row.id,
  parentThreadId: row.parent_thread_id,
  parentConversationId: Number(row.parent_conversation_id),
  parentTaskId: Number(row.parent_task_id),
  parentCallId: row.parent_call_id,
  subagentId: row.subagent_id,
  subagentName: row.subagent_name,
  childConversationId: Number(row.child_conversation_id),
  status: row.status,
  worktreePath: row.worktree_path,
  worktreeBranch: row.worktree_branch,
  resultSummary: row.result_summary,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
})

const COLUMNS = `d.id, d.parent_thread_id, d.parent_conversation_id, d.parent_task_id, d.parent_call_id,
  d.subagent_id, s.name AS subagent_name, d.child_conversation_id, d.status, d.worktree_path, d.worktree_branch,
  d.result_summary, d.started_at, d.finished_at`

/** The application-readable lifecycle beside the durable task that actually drives the delegation. */
export class DelegationRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema
  }

  /** Idempotent because a crash can repeat the child task's registration phase. */
  async start(input: StartDelegation): Promise<void> {
    await this.#select(
      `INSERT INTO ${this.#schema.tables.delegations}
        (id, parent_thread_id, parent_conversation_id, parent_task_id, parent_call_id, subagent_id,
         child_conversation_id, status, worktree_path, worktree_branch)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'running', $8, $9)
       ON CONFLICT (id) DO UPDATE SET child_conversation_id = excluded.child_conversation_id,
         worktree_path = excluded.worktree_path, worktree_branch = excluded.worktree_branch
       WHERE ${this.#schema.tables.delegations}.status = 'running'`,
      [input.id, input.parentThreadId, input.parentConversationId, input.parentTaskId, input.parentCallId,
        input.subagentId, input.childConversationId, input.worktreePath, input.worktreeBranch],
    )
  }

  async finish(id: string, status: Exclude<DelegationStatus, 'running'>, resultSummary: string): Promise<void> {
    await this.#select(
      `UPDATE ${this.#schema.tables.delegations} SET status = $2, result_summary = $3, finished_at = now()
       WHERE id = $1 AND status = 'running'`,
      [id, status, resultSummary],
    )
  }

  async listForThread(threadId: string): Promise<DelegationRecord[]> {
    const rows = await this.#select(
      `SELECT ${COLUMNS} FROM ${this.#schema.tables.delegations} d
       JOIN ${this.#schema.tables.agents} s ON s.id = d.subagent_id
       WHERE d.parent_thread_id = $1 ORDER BY d.started_at, d.id`,
      [threadId],
    )

    return rows.map(toDelegation)
  }

  async findByChildConversation(conversationId: number): Promise<DelegationRecord | undefined> {
    const rows = await this.#select(
      `SELECT ${COLUMNS} FROM ${this.#schema.tables.delegations} d
       JOIN ${this.#schema.tables.agents} s ON s.id = d.subagent_id
       WHERE d.child_conversation_id = $1`,
      [conversationId],
    )

    return rows[0] === undefined ? undefined : toDelegation(rows[0])
  }

  async #select<R extends QueryResultRow = DelegationRow>(text: string, values: readonly Value[]): Promise<R[]> {
    return withClient(this.#pool, (client) => rowsOf<R>(client, text, values))
  }
}
