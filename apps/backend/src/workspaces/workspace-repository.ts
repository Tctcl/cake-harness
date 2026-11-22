import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import { AppError } from '../errors.js'
import type { Value } from '../storage/postgres/db.js'
import { rowsOf, withClient, withTransaction } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/**
 * A dev container is a named image the platform publishes and builds in `apps/agent`, not a reference to an arbitrary
 * registry: a workspace may only ask for tooling the platform can actually provision.
 */
export interface WorkspaceContainer {
  readonly image: string
}

export interface Workspace {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
  readonly container: WorkspaceContainer | null
  readonly allowAll: boolean
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface WorkspaceInput {
  readonly name: string
  readonly description?: string
  readonly container?: WorkspaceContainer | null
  readonly allowAll?: boolean
}

export type WorkspacePatch = Partial<WorkspaceInput>

interface WorkspaceRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly is_default: boolean
  readonly container: unknown
  readonly allow_all: boolean
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

// The column is `jsonb` and only `image` is promised, so an unexpected shape is read as "no container" rather than
// guessed at. Writes are validated by the route schema, so this only guards rows written by something else.
const toContainer = (value: unknown): WorkspaceContainer | null => {
  if (typeof value !== 'object' || value === null || !('image' in value)) return null

  return typeof value.image === 'string' ? { image: value.image } : null
}

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  description: row.description,
  isDefault: row.is_default,
  container: toContainer(row.container),
  allowAll: row.allow_all,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const COLUMNS = `id, name, description, is_default, container, allow_all, archived_at, created_at, updated_at`

const immutable = (): AppError =>
  new AppError('the default workspace cannot be edited, archived or deleted', {
    statusCode: 403,
    code: 'WORKSPACE_IMMUTABLE',
  })

const inUse = (): AppError =>
  new AppError('the workspace still has live threads', {
    statusCode: 409,
    code: 'WORKSPACE_IN_USE',
  })

const notArchived = (): AppError =>
  new AppError('archive the workspace before deleting it', {
    statusCode: 409,
    code: 'WORKSPACE_NOT_ARCHIVED',
  })

/** Reads and writes `workspaces` over the pool the durable storage already owns. */
export class WorkspaceRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema
  // Statements whose text is not a value of this call live beside the columns they name, so the call sites bind only ids.
  readonly #sql: {
    readonly archive: string
    readonly archiveAgents: string
    readonly archiveThreads: string
    readonly deleteThreads: string
    readonly deleteAgents: string
    readonly deleteWorkspace: string
  }

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema

    const { tables } = schema
    const stamp = 'archived_at = now(), updated_at = now()'
    this.#sql = {
      archive: `UPDATE ${tables.workspaces} SET ${stamp} WHERE id = $1`,
      archiveAgents: `UPDATE ${tables.agents} SET ${stamp} WHERE workspace_id = $1 AND archived_at IS NULL`,
      archiveThreads: `UPDATE ${tables.chatThreads} SET ${stamp} WHERE workspace_id = $1 AND archived_at IS NULL`,
      deleteThreads: `DELETE FROM ${tables.chatThreads} WHERE workspace_id = $1`,
      deleteAgents: `DELETE FROM ${tables.agents} WHERE workspace_id = $1`,
      deleteWorkspace: `DELETE FROM ${tables.workspaces} WHERE id = $1`,
    }
  }

  /** Workspaces of `ownerId`, most recently changed first: the live ones, or the archived ones when asked for. */
  async list(ownerId: string, options: { archived?: boolean | undefined } = {}): Promise<Workspace[]> {
    const visible = options.archived === true ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.workspaces}
      WHERE owner_id = $1 AND ${visible} ORDER BY updated_at DESC`

    return (await this.#select(text, [ownerId])).map(toWorkspace)
  }

  /** The workspace new threads land in unless they name another. */
  async default(ownerId: string): Promise<Workspace | undefined> {
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.workspaces}
      WHERE owner_id = $1 AND is_default`

    return this.#one(text, [ownerId])
  }

  async find(id: string): Promise<Workspace | undefined> {
    return this.#one(`SELECT ${COLUMNS} FROM ${this.#schema.tables.workspaces} WHERE id = $1`, [id])
  }

  async create(ownerId: string, input: WorkspaceInput): Promise<Workspace> {
    const text = `INSERT INTO ${this.#schema.tables.workspaces}
      (id, owner_id, name, description, container, allow_all)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`
    const rows = await this.#select(text, [
      randomUUID(),
      ownerId,
      input.name,
      input.description ?? '',
      containerValue(input.container),
      input.allowAll ?? false,
    ])
    const row = rows[0]
    if (row === undefined) throw new Error('The workspace insert returned no row')

    return toWorkspace(row)
  }

  /** Edit a workspace, or answer `undefined` when the id is unknown. The default one is immutable. */
  async update(id: string, patch: WorkspacePatch): Promise<Workspace | undefined> {
    const existing = await this.find(id)
    if (existing === undefined) return undefined
    if (existing.isDefault) throw immutable()

    const assignments: string[] = []
    const values: Value[] = []
    const assign = (column: string, value: Value): void => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }

    if (patch.name !== undefined) assign('name', patch.name)
    if (patch.description !== undefined) assign('description', patch.description)
    if (patch.container !== undefined) assign('container', containerValue(patch.container))
    if (patch.allowAll !== undefined) assign('allow_all', patch.allowAll)
    if (assignments.length === 0) return existing

    values.push(id)
    const text = `UPDATE ${this.#schema.tables.workspaces} SET ${assignments.join(', ')}, updated_at = now()
      WHERE id = $${values.length} RETURNING ${COLUMNS}`

    return this.#one(text, values)
  }

  /**
   * Archive a workspace together with its agents and its threads, in one transaction: the workspace is the scope, so
   * archiving it while its work stayed live would leave rows nobody can reach. Idempotent, and `undefined` only when
   * the id is unknown.
   */
  async archive(id: string): Promise<Workspace | undefined> {
    const existing = await this.find(id)
    if (existing === undefined) return undefined
    if (existing.isDefault) throw immutable()
    if (existing.archivedAt !== null) return existing

    await withTransaction(this.#pool, async (client) => {
      await client.query(this.#sql.archive, [id])
      await client.query(this.#sql.archiveAgents, [id])
      await client.query(this.#sql.archiveThreads, [id])
    })

    return this.find(id)
  }

  /**
   * Lift the archive from this workspace alone. Its agents and threads stay archived: each row is restored on its own,
   * so nothing the user archived separately comes back by surprise.
   */
  async restore(id: string): Promise<Workspace | undefined> {
    const existing = await this.find(id)
    if (existing === undefined) return undefined
    if (existing.isDefault) throw immutable()
    if (existing.archivedAt === null) return existing

    const text = `UPDATE ${this.#schema.tables.workspaces} SET archived_at = NULL, updated_at = now()
      WHERE id = $1 RETURNING ${COLUMNS}`

    return this.#one(text, [id])
  }

  /**
   * Delete an archived workspace together with its archived agents and threads. Deleting is the second half of
   * archiving, so a live workspace is refused; so is one holding a thread that was restored on its own, because that
   * thread would go with it.
   */
  async remove(id: string): Promise<boolean> {
    const existing = await this.find(id)
    if (existing === undefined) return false
    if (existing.isDefault) throw immutable()
    if (existing.archivedAt === null) throw notArchived()

    const { tables } = this.#schema
    const live = await this.#select(
      `SELECT id FROM ${tables.chatThreads} WHERE workspace_id = $1 AND archived_at IS NULL LIMIT 1`,
      [id],
    )
    if (live.length > 0) throw inUse()

    await withTransaction(this.#pool, async (client) => {
      await client.query(this.#sql.deleteThreads, [id])
      await client.query(this.#sql.deleteAgents, [id])
      await client.query(this.#sql.deleteWorkspace, [id])
    })

    return true
  }

  async #one(text: string, values: readonly Value[]): Promise<Workspace | undefined> {
    const rows = await this.#select(text, values)

    return rows[0] === undefined ? undefined : toWorkspace(rows[0])
  }

  async #select(text: string, values: readonly Value[]): Promise<WorkspaceRow[]> {
    return withClient(this.#pool, (client) => rowsOf<WorkspaceRow>(client, text, values))
  }
}

// `jsonb` takes JSON text; `null` clears the container and is distinct from "not part of this write", which is handled
// by the caller before it gets here.
const containerValue = (container: WorkspaceContainer | null | undefined): Value =>
  container === undefined || container === null ? null : JSON.stringify(container)
