import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import type { PostgresSchema } from '../storage/postgres/schema.js'

/**
 * What a credential is for. An `opencode-go` key authenticates the model provider and names the account it belongs to;
 * an `mcp` key authenticates one MCP server, which is what `mcpId` says. The two carry different fields, and the table's
 * check constraint keeps a row from carrying both.
 */
export type CredentialKind = 'opencode-go' | 'mcp'

/** A credential as the API serves it: the secret is written, never read back. */
export interface Credential {
  readonly id: string
  readonly kind: CredentialKind
  readonly name: string
  /** ISO 8601, or `null` for a key that does not expire. */
  readonly expiresAt: string | null
  readonly email: string | null
  readonly note: string | null
  /** The MCP server this key answers for, for `kind: 'mcp'`. Free text: a key may be created before its server. */
  readonly mcpId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CredentialInput {
  readonly kind: CredentialKind
  readonly name: string
  readonly value: string
  readonly expiresAt?: string | null
  readonly email?: string | null
  readonly note?: string | null
  readonly mcpId?: string | null
}

interface CredentialRow {
  readonly id: string
  readonly kind: CredentialKind
  readonly name: string
  readonly expires_at: Date | null
  readonly email: string | null
  readonly note: string | null
  readonly mcp_id: string | null
  readonly created_at: Date
  readonly updated_at: Date
}

const COLUMNS = 'id, kind, name, expires_at, email, note, mcp_id, created_at, updated_at'

const toCredential = (row: CredentialRow): Credential => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  expiresAt: row.expires_at?.toISOString() ?? null,
  email: row.email,
  note: row.note,
  mcpId: row.mcp_id,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
})

/** A date the client sent as an ISO string, stored as a timestamp; `null` stays `null`, which means "never". */
const toDate = (value: string | null): Date | null => (value === null ? null : new Date(value))

/**
 * The secrets a user owns, one row per key. Kept out of the capability tables on purpose: a key outlives the server it
 * authenticates, so deleting an MCP server must not delete the key someone pasted into this page.
 */
export class CredentialRepository {
  constructor(
    private readonly pool: Pool,
    private readonly schema: PostgresSchema,
  ) {}

  /** Newest first, which is the order the page shows and the order of "what did I just add". */
  async list(ownerId: string): Promise<Credential[]> {
    const { rows } = await this.pool.query<CredentialRow>(
      `SELECT ${COLUMNS} FROM ${this.schema.tables.userCredentials}
        WHERE owner_id = $1
        ORDER BY created_at DESC`,
      [ownerId],
    )

    return rows.map(toCredential)
  }

  async find(ownerId: string, id: string): Promise<Credential | undefined> {
    const { rows } = await this.pool.query<CredentialRow>(
      `SELECT ${COLUMNS} FROM ${this.schema.tables.userCredentials} WHERE owner_id = $1 AND id = $2`,
      [ownerId, id],
    )

    const [row] = rows

    return row === undefined ? undefined : toCredential(row)
  }

  async create(ownerId: string, input: CredentialInput): Promise<Credential> {
    const text = `INSERT INTO ${this.schema.tables.userCredentials}
        (id, owner_id, kind, name, value, expires_at, email, note, mcp_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING ${COLUMNS}`
    const { rows } = await this.pool.query<CredentialRow>(text, [
        randomUUID(),
        ownerId,
        input.kind,
        input.name,
        input.value,
        toDate(input.expiresAt ?? null),
        input.kind === 'opencode-go' ? (input.email ?? null) : null,
        input.kind === 'mcp' ? (input.note ?? null) : null,
        input.kind === 'mcp' ? (input.mcpId ?? null) : null,
      ],
    )

    const [row] = rows
    if (row === undefined) throw new Error('the credential was not written')

    return toCredential(row)
  }

  /** `false` when the id is unknown or belongs to somebody else, which are the same answer at this layer. */
  async remove(ownerId: string, id: string): Promise<boolean> {
    const text = `DELETE FROM ${this.schema.tables.userCredentials} WHERE owner_id = $1 AND id = $2`
    const { rowCount } = await this.pool.query(text, [ownerId, id])

    return rowCount === 1
  }
}
