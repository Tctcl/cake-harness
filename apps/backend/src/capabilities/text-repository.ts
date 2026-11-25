import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import { AppError } from '../errors.js'
import type { Value } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/** A skill is a name, one line about it, and the text an agent is given. */
export interface TextEntry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly body: string
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface TextInput {
  readonly name: string
  readonly description?: string
  readonly body?: string
}

export type TextPatch = Partial<TextInput>

/** Where a kind lives and what references it, so one class can archive, refuse a delete and name its errors. */
export interface TextTable {
  readonly table: string
  readonly label: 'skill'
  readonly linkTable: string
  readonly linkColumn: string
}

interface TextRow {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly body: string
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
}

const COLUMNS = 'id, name, description, body, archived_at, created_at, updated_at'

const toEntry = (row: TextRow): TextEntry => ({
  id: row.id,
  name: row.name,
  description: row.description,
  body: row.body,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** The unique index on (owner_id, name) is the only constraint a writer can trip, and it deserves a stable code. */
const NAME_TAKEN = '23505'

/** Reads and writes one of the text catalogs over the pool the durable storage already owns. */
export class TextRepository {
  readonly #pool: Pool
  readonly #store: TextTable
  readonly #sql: {
    readonly list: string
    readonly find: string
    readonly insert: string
    readonly archive: string
    readonly restore: string
    readonly linked: string
    readonly remove: string
  }

  constructor(pool: Pool, store: TextTable) {
    this.#pool = pool
    this.#store = store

    const stamp = 'archived_at = now(), updated_at = now()'
    this.#sql = {
      list: `SELECT ${COLUMNS} FROM ${store.table} WHERE owner_id = $1 AND {visible} ORDER BY name`,
      find: `SELECT ${COLUMNS} FROM ${store.table} WHERE id = $1`,
      insert: `INSERT INTO ${store.table} (id, owner_id, name, description, body)
        VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      archive: `UPDATE ${store.table} SET ${stamp} WHERE id = $1 RETURNING ${COLUMNS}`,
      restore: `UPDATE ${store.table} SET archived_at = NULL, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
      linked: `SELECT 1 FROM ${store.linkTable} WHERE ${store.linkColumn} = $1 LIMIT 1`,
      // The link tables cascade, but a grant disappearing with its subject is a silent change to a workspace, so a
      // referenced row is refused instead.
      remove: `DELETE FROM ${store.table} WHERE id = $1`,
    }
  }

  /** The owner's entries by name, live ones by default: the archived ones only when asked for. */
  async list(ownerId: string, options: { archived?: boolean | undefined } = {}): Promise<TextEntry[]> {
    const visible = options.archived === true ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'
    const text = this.#sql.list.replace('{visible}', visible)

    return (await this.#pool.query<TextRow>(text, [ownerId])).rows.map(toEntry)
  }

  async find(id: string): Promise<TextEntry | undefined> {
    return (await this.#pool.query<TextRow>(this.#sql.find, [id])).rows.map(toEntry)[0]
  }

  async findByName(ownerId: string, name: string): Promise<TextEntry | undefined> {
    const text = `SELECT ${COLUMNS} FROM ${this.#store.table} WHERE owner_id = $1 AND name = $2`

    return (await this.#pool.query<TextRow>(text, [ownerId, name])).rows.map(toEntry)[0]
  }

  async create(ownerId: string, input: TextInput): Promise<TextEntry> {
    const values: Value[] = [randomUUID(), ownerId, input.name, input.description ?? '', input.body ?? '']

    try {
      const { rows } = await this.#pool.query<TextRow>(this.#sql.insert, values)
      const created = rows[0]
      if (created === undefined) throw new AppError(`the ${this.#store.label} was not written`, { statusCode: 500, code: 'WRITE_FAILED' })

      return toEntry(created)
    } catch (error) {
      throw this.#nameTaken(error)
    }
  }

  async update(id: string, patch: TextPatch): Promise<TextEntry> {
    const assignments: string[] = []
    const values: Value[] = [id]
    const bind = (column: string, value: Value): void => {
      values.push(value)
      assignments.push(`${column} = $${values.length}`)
    }
    if (patch.name !== undefined) bind('name', patch.name)
    if (patch.description !== undefined) bind('description', patch.description)
    if (patch.body !== undefined) bind('body', patch.body)
    if (assignments.length === 0) return await this.#one(this.#sql.find, [id])

    assignments.push('updated_at = now()')
    const text = `UPDATE ${this.#store.table} SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`

    try {
      return await this.#one(text, values)
    } catch (error) {
      throw this.#nameTaken(error)
    }
  }

  async archive(id: string): Promise<TextEntry> {
    return await this.#one(this.#sql.archive, [id])
  }

  async restore(id: string): Promise<TextEntry> {
    return await this.#one(this.#sql.restore, [id])
  }

  /** Refused while a workspace or an agent still points at the row: archiving it is the way to retire it. */
  async delete(id: string): Promise<void> {
    const linked = await this.#pool.query(this.#sql.linked, [id])
    if (linked.rows.length > 0) {
      throw new AppError(`the ${this.#store.label} is still granted somewhere`, {
        statusCode: 409,
        code: 'CAPABILITY_IN_USE',
      })
    }

    await this.#pool.query(this.#sql.remove, [id])
  }

  async #one(text: string, values: readonly Value[]): Promise<TextEntry> {
    const { rows } = await this.#pool.query<TextRow>(text, [...values])
    const row = rows[0]
    if (row === undefined) {
      throw new AppError(`the ${this.#store.label} does not exist`, {
        statusCode: 404,
        code: `${this.#store.label.toUpperCase()}_NOT_FOUND`,
      })
    }

    return toEntry(row)
  }

  #nameTaken(error: unknown): Error {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === NAME_TAKEN) {
      return new AppError(`a ${this.#store.label} with that name already exists`, {
        statusCode: 409,
        code: 'NAME_TAKEN',
      })
    }

    return error instanceof Error ? error : new Error(String(error))
  }
}

/** Skills live in their own table so they can grow without moving other catalog rows. */
export class SkillRepository extends TextRepository {
  constructor(pool: Pool, schema: PostgresSchema) {
    super(pool, {
      table: schema.tables.skills,
      label: 'skill',
      linkTable: schema.tables.workspaceSkills,
      linkColumn: 'skill_id',
    })
  }
}
