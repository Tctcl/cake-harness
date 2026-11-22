import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import type { Value } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/**
 * A tool the platform can offer. The row is a pointer, not a definition: the implementation lives in a registry
 * extension, so the catalog is written from what is installed and a name here always resolves to code.
 */
export interface Tool {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly source: string
  readonly inputSchema: unknown
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** What an installed extension offers, in the shape the sync needs. */
export interface ToolOffer {
  readonly name: string
  readonly description?: string
  readonly parameters?: unknown
}

interface ToolRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly source: string
  readonly input_schema: unknown
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

const COLUMNS = 'id, name, description, source, input_schema, archived_at, created_at, updated_at'

const toTool = (row: ToolRow): Tool => ({
  id: row.id,
  name: row.name,
  description: row.description,
  source: row.source,
  inputSchema: row.input_schema,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/**
 * The `tools` catalog. Rows are written by `sync` from the installed registry extensions and never by a user, so a
 * grant can only name a tool that exists in code. A tool that disappears from the registry is archived rather than
 * deleted, because grants point at it and a vanished row would take them with it.
 */
export class ToolRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema
  readonly #upsert: string
  readonly #retire: string

  constructor(pool: Pool, schema: PostgresSchema) {
    this.#pool = pool
    this.#schema = schema
    this.#upsert = `INSERT INTO ${schema.tables.tools}
      (id, owner_id, name, description, source, input_schema)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (owner_id, name) DO UPDATE SET
        description = EXCLUDED.description,
        source = EXCLUDED.source,
        input_schema = EXCLUDED.input_schema,
        archived_at = NULL,
        updated_at = now()`
    this.#retire = `UPDATE ${schema.tables.tools} SET archived_at = now(), updated_at = now()
      WHERE owner_id = $1 AND archived_at IS NULL AND name <> ALL($2)`
  }

  async list(ownerId: string, options: { archived?: boolean | undefined } = {}): Promise<Tool[]> {
    const visible = options.archived === true ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.tools} WHERE owner_id = $1 AND ${visible} ORDER BY name`

    return (await this.#pool.query<ToolRow>(text, [ownerId])).rows.map(toTool)
  }

  async find(id: string): Promise<Tool | undefined> {
    const text = `SELECT ${COLUMNS} FROM ${this.#schema.tables.tools} WHERE id = $1`

    return (await this.#pool.query<ToolRow>(text, [id])).rows.map(toTool)[0]
  }

  /** Makes the catalog match what the registry offers: upserted by name, and anything no longer offered is archived. */
  async sync(
    ownerId: string,
    offers: readonly ToolOffer[],
    options: { source?: string } = {},
  ): Promise<void> {
    const source = options.source ?? 'registry'
    const names: string[] = []

    for (const offer of offers) {
      names.push(offer.name)
      const values: Value[] = [
        randomUUID(),
        ownerId,
        offer.name,
        offer.description ?? '',
        source,
        offer.parameters === undefined ? null : JSON.stringify(offer.parameters),
      ]
      await this.#pool.query(this.#upsert, values)
    }

    await this.#pool.query(this.#retire, [ownerId, names])
  }
}
