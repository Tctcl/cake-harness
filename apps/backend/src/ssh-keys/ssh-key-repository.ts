import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import type { PostgresSchema } from '../storage/postgres/schema.js'

export interface UserSshKey {
  readonly id: string
  readonly name: string
  readonly publicKey: string
  readonly fingerprint: string
  readonly createdAt: string
}

interface UserSshKeyRow {
  readonly id: string
  readonly name: string
  readonly public_key: string
  readonly fingerprint: string
  readonly created_at: Date
}

const COLUMNS = 'id, name, public_key, fingerprint, created_at'

const toKey = (row: UserSshKeyRow): UserSshKey => ({
  id: row.id,
  name: row.name,
  publicKey: row.public_key,
  fingerprint: row.fingerprint,
  createdAt: row.created_at.toISOString(),
})

export interface SshKeyStore {
  list(ownerId: string): Promise<UserSshKey[]>
  publicKeys(ownerId: string): Promise<readonly string[]>
  create(ownerId: string, name: string, publicKey: string, fingerprint: string): Promise<UserSshKey>
  remove(ownerId: string, id: string): Promise<boolean>
}

/** Only public key material crosses this boundary; there is deliberately no private-key column or parameter. */
export class SshKeyRepository implements SshKeyStore {
  constructor(
    private readonly pool: Pool,
    private readonly schema: PostgresSchema,
  ) {}

  async list(ownerId: string): Promise<UserSshKey[]> {
    const { rows } = await this.pool.query<UserSshKeyRow>(
      `SELECT ${COLUMNS} FROM ${this.schema.tables.userSshKeys} WHERE owner_id = $1 ORDER BY created_at, id`,
      [ownerId],
    )

    return rows.map(toKey)
  }

  async publicKeys(ownerId: string): Promise<readonly string[]> {
    const { rows } = await this.pool.query<{ readonly public_key: string }>(
      `SELECT public_key FROM ${this.schema.tables.userSshKeys} WHERE owner_id = $1 ORDER BY created_at, id`,
      [ownerId],
    )

    return rows.map((row) => row.public_key)
  }

  async create(ownerId: string, name: string, publicKey: string, fingerprint: string): Promise<UserSshKey> {
    const { rows } = await this.pool.query<UserSshKeyRow>(
      `INSERT INTO ${this.schema.tables.userSshKeys} (id, owner_id, name, public_key, fingerprint)
        VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
      [randomUUID(), ownerId, name, publicKey, fingerprint],
    )
    const row = rows[0]
    if (row === undefined) throw new Error('the SSH key was not written')

    return toKey(row)
  }

  async remove(ownerId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM ${this.schema.tables.userSshKeys} WHERE owner_id = $1 AND id = $2`,
      [ownerId, id],
    )

    return rowCount === 1
  }
}
