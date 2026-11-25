import { randomUUID } from 'node:crypto'

import type { Pool, QueryResultRow } from 'pg'

import type { Value } from '../storage/postgres/db.js'
import { rowsOf, withClient, withTransaction } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/**
 * One development environment: the container an agent works in, named and addressed on its own rather than as a
 * property of a workspace. `containerId` is what Docker called it when it was started, and stays `null` until then.
 */
export interface DevEnvironment {
  readonly id: string
  readonly name: string
  readonly image: string
  readonly containerId: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface EnvironmentInput {
  readonly name: string
  /** The image Cake publishes for this environment; Cake's own, never an arbitrary registry tag. */
  readonly image: string
}

export type EnvironmentPatch = Partial<EnvironmentInput>

interface EnvironmentRow {
  readonly id: string
  readonly name: string
  readonly image: string
  readonly container_id: string | null
  readonly created_at: Date
  readonly updated_at: Date
}

const toEnvironment = (row: EnvironmentRow): DevEnvironment => ({
  id: row.id,
  name: row.name,
  image: row.image,
  containerId: row.container_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const COLUMNS = `id, name, image, container_id, created_at, updated_at`

/** One stored report: the document as the container sent it, and the instant the container said it was produced. */
export interface ReportedState {
  readonly state: unknown
  readonly reportedAt: Date
}

interface ReportedStateRow {
  readonly reported_state: unknown
  readonly reported_at: Date
}

/**
 * Reads and writes `dev_environments` and the two link tables. The links carry no payload: a workspace offers an
 * environment to its agents, and an agent works in exactly one of the offered ones for now.
 */
export class EnvironmentRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema
  readonly #sql: {
    readonly byWorkspace: string
    readonly workspacesOf: string
    readonly attach: string
    readonly detach: string
    readonly byAgent: string
    readonly disconnect: string
    readonly remove: string
    readonly connect: string
  }

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema

    const { tables } = schema
    this.#sql = {
      byWorkspace: `SELECT e.id, e.name, e.image, e.container_id, e.created_at, e.updated_at
        FROM ${tables.devEnvironments} e
        JOIN ${tables.workspaceEnvironments} w ON w.environment_id = e.id
        WHERE w.workspace_id = $1 ORDER BY e.updated_at DESC`,
      workspacesOf: `SELECT workspace_id FROM ${tables.workspaceEnvironments} WHERE environment_id = $1`,
      attach: `INSERT INTO ${tables.workspaceEnvironments} (workspace_id, environment_id) VALUES ($1, $2)
        ON CONFLICT DO NOTHING`,
      detach: `DELETE FROM ${tables.workspaceEnvironments} WHERE workspace_id = $1 AND environment_id = $2`,
      byAgent: `SELECT e.id, e.name, e.image, e.container_id, e.created_at, e.updated_at
        FROM ${tables.devEnvironments} e
        JOIN ${tables.agentEnvironments} a ON a.environment_id = e.id
        WHERE a.agent_id = $1`,
      disconnect: `DELETE FROM ${tables.agentEnvironments} WHERE agent_id = $1`,
      remove: `DELETE FROM ${tables.devEnvironments} WHERE id = $1`,
      connect: `INSERT INTO ${tables.agentEnvironments} (agent_id, environment_id) VALUES ($1, $2)`,
    }
  }

  /** Environments of `ownerId`, most recently changed first. */
  async list(ownerId: string): Promise<DevEnvironment[]> {
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.devEnvironments}
      WHERE owner_id = $1 ORDER BY updated_at DESC`

    return (await this.#select(text, [ownerId])).map(toEnvironment)
  }

  async find(id: string): Promise<DevEnvironment | undefined> {
    return this.#one(`SELECT ${COLUMNS} FROM ${this.#schema.tables.devEnvironments} WHERE id = $1`, [id])
  }

  async create(ownerId: string, input: EnvironmentInput): Promise<DevEnvironment> {
    const text = `INSERT INTO ${this.#schema.tables.devEnvironments} (id, owner_id, name, image)
      VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`
    const rows = await this.#select(text, [randomUUID(), ownerId, input.name, input.image])
    const row = rows[0]
    if (row === undefined) throw new Error('The environment insert returned no row')

    return toEnvironment(row)
  }

  /** Answer `undefined` when the id is unknown. */
  async update(id: string, patch: EnvironmentPatch): Promise<DevEnvironment | undefined> {
    const assignments: string[] = []
    const values: Value[] = []
    const assign = (column: string, value: Value): void => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }

    if (patch.name !== undefined) assign('name', patch.name)
    if (patch.image !== undefined) assign('image', patch.image)
    if (assignments.length === 0) return this.find(id)

    values.push(id)
    const text = `UPDATE ${this.#schema.tables.devEnvironments} SET ${assignments.join(', ')}, updated_at = now()
      WHERE id = $${values.length} RETURNING ${COLUMNS}`

    return this.#one(text, values)
  }

  /** Record which container this environment runs as, or clear it once the container is gone. */
  async setContainer(id: string, containerId: string | null): Promise<DevEnvironment | undefined> {
    const text = `UPDATE ${this.#schema.tables.devEnvironments}
      SET container_id = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`

    return this.#one(text, [id, containerId])
  }

  /**
   * Store what the environment reported about itself. `updated_at` is deliberately untouched: a report is the container
   * talking, not the user changing something, and the list orders by what the user changed.
   */
  async recordState(id: string, state: unknown): Promise<boolean> {
    const text = `UPDATE ${this.#schema.tables.devEnvironments}
      SET reported_state = $2, reported_at = now() WHERE id = $1`
    const result = await withClient(this.#pool, (client) =>
      client.query(text, [id, JSON.stringify(state)]),
    )

    return (result.rowCount ?? 0) > 0
  }

  /** The last report, or `undefined` when the environment is unknown or has never reported. */
  async reportedState(id: string): Promise<ReportedState | undefined> {
    const text = `SELECT reported_state, reported_at FROM ${this.#schema.tables.devEnvironments}
      WHERE id = $1 AND reported_state IS NOT NULL`
    const rows = await this.#select<ReportedStateRow>(text, [id])
    const row = rows[0]
    if (row === undefined || row.reported_at === null) return undefined

    return { state: row.reported_state, reportedAt: row.reported_at }
  }

  /** The links go with the row, so a deleted environment disappears from every workspace and agent that named it. */
  async remove(id: string): Promise<boolean> {
    const result = await withClient(this.#pool, (client) => client.query(this.#sql.remove, [id]))

    return (result.rowCount ?? 0) > 0
  }

  /** The environments a workspace offers its agents. */
  async ofWorkspace(workspaceId: string): Promise<DevEnvironment[]> {
    return (await this.#select(this.#sql.byWorkspace, [workspaceId])).map(toEnvironment)
  }

  /** The workspaces offering this environment, as ids: a workspace has no payload to return here. */
  async workspacesOf(environmentId: string): Promise<string[]> {
    const rows = await this.#select(this.#sql.workspacesOf, [environmentId])

    return rows.map((row) => row.id)
  }

  /** `false` when the workspace already offers it, which is the state the caller asked for either way. */
  async attach(workspaceId: string, environmentId: string): Promise<boolean> {
    const result = await withClient(this.#pool, (client) =>
      client.query(this.#sql.attach, [workspaceId, environmentId]),
    )

    return (result.rowCount ?? 0) > 0
  }

  async detach(workspaceId: string, environmentId: string): Promise<boolean> {
    const result = await withClient(this.#pool, (client) =>
      client.query(this.#sql.detach, [workspaceId, environmentId]),
    )

    return (result.rowCount ?? 0) > 0
  }

  /** The environment an agent works in, if it has one. */
  async ofAgent(agentId: string): Promise<DevEnvironment | undefined> {
    return this.#one(this.#sql.byAgent, [agentId])
  }

  /**
   * Point an agent at an environment, replacing the one it had. The table is many-to-many and a unique index on
   * `agent_id` holds it to one today, so the replace is the delete-then-insert the index requires, in one transaction:
   * a failed insert must not leave the agent with none.
   */
  async connectAgent(agentId: string, environmentId: string): Promise<void> {
    await withTransaction(this.#pool, async (client) => {
      await client.query(this.#sql.disconnect, [agentId])
      await client.query(this.#sql.connect, [agentId, environmentId])
    })
  }

  /** `false` when the agent already had none. */
  async disconnectAgent(agentId: string): Promise<boolean> {
    const result = await withClient(this.#pool, (client) =>
      client.query(this.#sql.disconnect, [agentId]),
    )

    return (result.rowCount ?? 0) > 0
  }

  async #one(text: string, values: readonly Value[]): Promise<DevEnvironment | undefined> {
    const rows = await this.#select(text, values)

    return rows[0] === undefined ? undefined : toEnvironment(rows[0])
  }

  async #select<R extends QueryResultRow = EnvironmentRow>(text: string, values: readonly Value[]): Promise<R[]> {
    return withClient(this.#pool, (client) => rowsOf<R>(client, text, values))
  }
}
