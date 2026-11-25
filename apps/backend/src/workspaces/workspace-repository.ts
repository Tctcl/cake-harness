import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import { AppError } from '../errors.js'
import type { Value } from '../storage/postgres/db.js'
import { rowsOf, withClient, withTransaction } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'
import type { SshPortRange } from '../environments/ssh-ports.js'
import { DEFAULT_SSH_PORT_RANGE, reserveSshPort } from '../environments/ssh-ports.js'
import {
  PLAN_AGENT_DESCRIPTION,
  PLAN_AGENT_INSTRUCTIONS,
  PLAN_AGENT_NAME,
  WORKSPACE_AGENT_DESCRIPTION,
  WORKSPACE_AGENT_NAME,
} from './defaults.js'

/**
 * A workspace: the scope threads and agents live in, and the container they run in. Each workspace owns exactly one
 * environment, created with it or repaired at startup; General's container serves skills and MCP servers, not agent tools.
 */
export interface Workspace {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
  readonly allowAll: boolean
  readonly archivedAt: Date | null
  /** Where the workspace sits in the user's list, 0 at the top. Ordering is the user's, not a recency signal. */
  readonly position: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface WorkspaceInput {
  readonly name: string
  readonly description?: string
  readonly allowAll?: boolean
}

export type WorkspacePatch = Partial<WorkspaceInput>

interface WorkspaceRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly is_default: boolean
  readonly allow_all: boolean
  readonly archived_at: Date | null
  readonly position: number
  readonly created_at: Date
  readonly updated_at: Date
}

const toWorkspace = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  description: row.description,
  isDefault: row.is_default,
  allowAll: row.allow_all,
  archivedAt: row.archived_at,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

interface MissingEnvironmentRow {
  readonly id: string
  readonly owner_id: string
  readonly name: string
}

const COLUMNS = `id, name, description, is_default, allow_all, archived_at, position, created_at, updated_at`

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
  readonly #sshPortRange: SshPortRange
  // Statements whose text is not a value of this call live beside the columns they name, so the call sites bind only ids.
  readonly #sql: {
    readonly archive: string
    readonly archiveAgents: string
    readonly archiveThreads: string
    readonly deleteThreads: string
    readonly deleteAgents: string
    readonly deleteWorkspace: string
    readonly reposition: string
    readonly insertOnTop: string
    readonly insertEnvironment: string
    readonly attachEnvironment: string
    readonly insertDefaultAgent: string
    readonly insertPlanAgent: string
    readonly ensurePlanTools: string
    readonly grantPlanTools: string
  }

  constructor(pool: Pool, schema: PostgresSchema, sshPortRange: SshPortRange = DEFAULT_SSH_PORT_RANGE) {
    this.#pool = pool
    this.#schema = schema
    this.#sshPortRange = sshPortRange

    const { tables } = schema
    const stamp = 'archived_at = now(), updated_at = now()'
    this.#sql = {
      archive: `UPDATE ${tables.workspaces} SET ${stamp} WHERE id = $1`,
      archiveAgents: `UPDATE ${tables.agents} SET ${stamp} WHERE workspace_id = $1 AND archived_at IS NULL`,
      archiveThreads: `UPDATE ${tables.chatThreads} SET ${stamp} WHERE workspace_id = $1 AND archived_at IS NULL`,
      deleteThreads: `DELETE FROM ${tables.chatThreads} WHERE workspace_id = $1`,
      deleteAgents: `DELETE FROM ${tables.agents} WHERE workspace_id = $1`,
      deleteWorkspace: `DELETE FROM ${tables.workspaces} WHERE id = $1`,
      reposition: `UPDATE ${tables.workspaces} SET position = $2 WHERE id = $1`,
      // A new workspace takes position 0 and pushes the rest down one: the arrangement is stored, so "newest on top"
      // has to be written, not inferred from a timestamp later.
      insertOnTop: `WITH shifted AS (
          UPDATE ${tables.workspaces} SET position = position + 1
          WHERE owner_id = $2 AND archived_at IS NULL
        )
        INSERT INTO ${tables.workspaces}
          (id, owner_id, name, description, allow_all, position)
        VALUES ($1, $2, $3, $4, $5, 0) RETURNING ${COLUMNS}`,
      insertEnvironment: `INSERT INTO ${tables.devEnvironments} (id, owner_id, name, image, ssh_port)
        VALUES ($1, $2, $3, $4, $5)`,
      attachEnvironment: `INSERT INTO ${tables.workspaceEnvironments} (workspace_id, environment_id)
        VALUES ($1, $2)`,
      // Every workspace starts with an agent, so a conversation can start there before anyone opens the Agents tab.
      insertDefaultAgent: `INSERT INTO ${tables.agents}
          (id, workspace_id, name, description, is_default, allow_all)
        VALUES ($1, $2, '${WORKSPACE_AGENT_NAME}', '${WORKSPACE_AGENT_DESCRIPTION}', true, true)`,
      insertPlanAgent: `INSERT INTO ${tables.agents}
          (id, workspace_id, name, description, is_default, allow_all, instructions)
        VALUES ($1, $2, '${PLAN_AGENT_NAME}', '${PLAN_AGENT_DESCRIPTION}', false, false, $3)`,
      // Creation also works without a prior startup sync, so Plan's catalog rows are resolved in this transaction.
      ensurePlanTools: `INSERT INTO ${tables.tools} (id, owner_id, name)
        VALUES ($1, $2, 'read'), ($3, $2, 'grep'), ($4, $2, 'find'), ($5, $2, 'ls'),
          ($6, $2, 'git'), ($7, $2, 'web_fetch'), ($8, $2, 'ask_user')
        ON CONFLICT (owner_id, name) DO UPDATE SET archived_at = NULL, updated_at = now()`,
      grantPlanTools: `INSERT INTO ${tables.agentTools} (agent_id, tool_id)
        SELECT $1, id FROM ${tables.tools} WHERE owner_id = $2 AND name = ANY($3)
        ON CONFLICT DO NOTHING`,
    }
  }

  /**
   * Workspaces of `ownerId` in the user's own order: the live ones, or the archived ones when asked for. Newest library
   * work lands on top because `create` puts it at position 0, and after that only `reorder` moves a row.
   */
  async list(ownerId: string, options: { archived?: boolean | undefined } = {}): Promise<Workspace[]> {
    const visible = options.archived === true ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.workspaces}
      WHERE owner_id = $1 AND ${visible} ORDER BY position, created_at DESC`

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

  /**
   * Create a workspace and the one environment it runs in, in a single transaction: a workspace without a container is
   * a broken workspace, so the row and its link become visible together or not at all. The environment takes the
   * workspace's name — both describe the same thing — and the image the caller passes, because the image is
   * configuration and this module holds none.
   */
  async create(ownerId: string, input: WorkspaceInput, environmentImage: string): Promise<Workspace> {
    const id = randomUUID()
    const environmentId = randomUUID()

    const rows = await withTransaction(this.#pool, async (client) => {
      const sshPort = await reserveSshPort(client, this.#schema, this.#sshPortRange)
      const inserted = await rowsOf<WorkspaceRow>(client, this.#sql.insertOnTop, [
        id,
        ownerId,
        input.name,
        input.description ?? '',
        input.allowAll ?? false,
      ])
      await client.query(this.#sql.insertEnvironment, [environmentId, ownerId, input.name, environmentImage, sshPort])
      await client.query(this.#sql.attachEnvironment, [id, environmentId])
      await client.query(this.#sql.insertDefaultAgent, [randomUUID(), id])
      const planId = randomUUID()
      await client.query(this.#sql.insertPlanAgent, [planId, id, PLAN_AGENT_INSTRUCTIONS])
      await client.query(this.#sql.ensurePlanTools, [
        randomUUID(),
        ownerId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ])
      await client.query(this.#sql.grantPlanTools, [
        planId,
        ownerId,
        ['read', 'grep', 'find', 'ls', 'git', 'web_fetch', 'ask_user'],
      ])

      return inserted
    })
    const row = rows[0]
    if (row === undefined) throw new Error('The workspace insert returned no row')

    return toWorkspace(row)
  }

  /**
   * Give every workspace that has no environment one, and answer how many were created.
   *
   * The image comes from configuration, which a migration cannot see, so this runs at startup instead: a migration that
   * guessed a tag would pin the install to whatever was current the day the schema moved. Idempotent — it repairs an
   * install that predates the rule, including General's formerly host-only workspace, and does nothing on the next boot.
   */
  async ensureEnvironments(ownerId: string, image: string): Promise<number> {
    const missing = await withClient(this.#pool, (client) =>
      rowsOf<MissingEnvironmentRow>(
        client,
        `SELECT w.id, w.owner_id, w.name FROM ${this.#schema.tables.workspaces} w
          WHERE w.owner_id = $1
            AND NOT EXISTS (SELECT 1 FROM ${this.#schema.tables.workspaceEnvironments} link WHERE link.workspace_id = w.id)
          ORDER BY w.position`,
        [ownerId],
      ),
    )
    if (missing.length === 0) return 0

    await withTransaction(this.#pool, async (client) => {
      for (const row of missing) {
        const environmentId = randomUUID()
        const sshPort = await reserveSshPort(client, this.#schema, this.#sshPortRange)
        await client.query(this.#sql.insertEnvironment, [environmentId, row.owner_id, row.name, image, sshPort])
        await client.query(this.#sql.attachEnvironment, [row.id, environmentId])
      }
    })

    return missing.length
  }

  /**
   * Give every live workspace of `ownerId` that has no default agent one, and answer how many were created. Workspaces
   * made before every workspace got an agent could not start a conversation at all; this repairs them at startup and
   * does nothing on the next boot.
   */
  async ensureDefaultAgents(ownerId: string): Promise<number> {
    const { workspaces, agents } = this.#schema.tables
    const missing = await withClient(this.#pool, (client) =>
      rowsOf<{ readonly id: string }>(
        client,
        `SELECT w.id FROM ${workspaces} w
          WHERE w.owner_id = $1 AND w.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM ${agents} a WHERE a.workspace_id = w.id AND a.is_default)`,
        [ownerId],
      ),
    )
    if (missing.length === 0) return 0

    await withTransaction(this.#pool, async (client) => {
      for (const row of missing) await client.query(this.#sql.insertDefaultAgent, [randomUUID(), row.id])
    })

    return missing.length
  }

  /**
   * Rewrite the list order from `ownerId`'s ids, top first. The set has to be the live workspaces exactly: a partial
   * list would renumber some rows onto positions the others already hold, and the order would then depend on which
   * row the database happened to update first.
   */
  async reorder(ownerId: string, ids: readonly string[]): Promise<Workspace[]> {
    const current = await this.list(ownerId)
    const known = new Set(current.map((workspace) => workspace.id))
    const asked = new Set(ids)

    if (ids.length !== current.length || asked.size !== ids.length || ids.some((id) => !known.has(id))) {
      throw new AppError('the order must name every workspace exactly once', {
        statusCode: 400,
        code: 'WORKSPACE_ORDER_INVALID',
      })
    }

    await withTransaction(this.#pool, async (client) => {
      for (const [position, id] of ids.entries()) {
        await client.query(this.#sql.reposition, [id, position])
      }
    })

    return this.list(ownerId)
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
