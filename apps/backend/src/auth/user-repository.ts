import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import type { Value } from '../storage/postgres/db.js'
import { withClient } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/**
 * A person and the role they hold, as one read. The role is joined rather than looked up separately because every
 * decision about what someone may do needs both, and a second round trip could only disagree with this one.
 */
export interface UserRecord {
  readonly id: string
  readonly username: string | null
  readonly displayName: string
  readonly disabled: boolean
  readonly passwordHash: string | null
  readonly roleId: string | null
  readonly roleName: string | null
  /** The role is the built-in admin, which carries every permission including ones added later. */
  readonly grantsAll: boolean
  /** Sealed with the key from `.env`; `null` when this person has not enrolled a second factor. */
  readonly totpSecret: string | null
  readonly totpConfirmedAt: Date | null
  readonly mustChangePassword: boolean
  readonly createdAt: Date
}

interface UserRow {
  readonly id: string
  readonly username: string | null
  readonly display_name: string
  readonly disabled: boolean
  readonly password_hash: string | null
  readonly role_id: string | null
  readonly role_name: string | null
  readonly grants_all: boolean | null
  readonly totp_secret: string | null
  readonly totp_confirmed_at: Date | null
  readonly must_change_password: boolean
  readonly created_at: Date
}

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  disabled: row.disabled,
  passwordHash: row.password_hash,
  roleId: row.role_id,
  roleName: row.role_name,
  grantsAll: row.grants_all ?? false,
  totpSecret: row.totp_secret,
  totpConfirmedAt: row.totp_confirmed_at,
  mustChangePassword: row.must_change_password,
  createdAt: row.created_at,
})

/** Usernames are stored lowercased, so `Admin` and `admin` are one account rather than two that look alike. */
export const normaliseUsername = (username: string): string => username.trim().toLowerCase()

export interface NewUser {
  readonly username: string
  readonly displayName: string
  readonly passwordHash: string
  readonly roleId: string
  readonly mustChangePassword: boolean
}

export class UserRepository {
  readonly #pool: Pool
  readonly #schema: PostgresSchema
  /** Fixed statements live beside the columns they name, so a call site binds only values. */
  readonly #select: string
  readonly #setPassword: string
  readonly #clearTotp: string
  readonly #confirmTotp: string
  readonly #setRole: string
  readonly #setDisabled: string
  readonly #rename: string

  constructor(pool: Pool, schema: PostgresSchema) {
    const { users, roles } = schema.tables
    this.#pool = pool
    this.#schema = schema
    this.#select = `SELECT u.id, u.username, u.display_name, u.disabled, u.password_hash, u.role_id,
        r.name AS role_name, r.grants_all, u.totp_secret, u.totp_confirmed_at, u.must_change_password, u.created_at
      FROM ${users} u LEFT JOIN ${roles} r ON r.id = u.role_id`
    this.#setPassword = `UPDATE ${users} SET password_hash = $2, must_change_password = $3 WHERE id = $1`
    this.#clearTotp = `UPDATE ${users} SET totp_secret = $2, totp_confirmed_at = NULL WHERE id = $1`
    this.#confirmTotp = `UPDATE ${users} SET totp_confirmed_at = now() WHERE id = $1`
    this.#setRole = `UPDATE ${users} SET role_id = $2 WHERE id = $1`
    this.#setDisabled = `UPDATE ${users} SET disabled = $2 WHERE id = $1`
    this.#rename = `UPDATE ${users} SET username = $2, display_name = $3 WHERE id = $1`
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    const text = `${this.#select} WHERE u.id = $1`
    const rows = await withClient(this.#pool, (client) => client.query<UserRow>(text, [id]))
    const row = rows.rows[0]

    return row === undefined ? undefined : toUser(row)
  }

  /** Case-insensitive on purpose: a sign-in that fails because of a capital letter is a support ticket, not security. */
  async findByUsername(username: string): Promise<UserRecord | undefined> {
    const text = `${this.#select} WHERE lower(u.username) = $1`
    const rows = await withClient(this.#pool, (client) => client.query<UserRow>(text, [normaliseUsername(username)]))
    const row = rows.rows[0]

    return row === undefined ? undefined : toUser(row)
  }

  /** Everyone who can sign in, the seeded owner included once the installer has given it a name. */
  async list(): Promise<readonly UserRecord[]> {
    const text = `${this.#select} WHERE u.username IS NOT NULL ORDER BY u.created_at, u.display_name`
    const rows = await withClient(this.#pool, (client) => client.query<UserRow>(text))

    return rows.rows.map(toUser)
  }

  async create(user: NewUser): Promise<UserRecord> {
    const text = `INSERT INTO ${this.#schema.tables.users}
      (id, username, display_name, password_hash, role_id, must_change_password)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
    const values: Value[] = [
      randomUUID(),
      normaliseUsername(user.username),
      user.displayName,
      user.passwordHash,
      user.roleId,
      user.mustChangePassword,
    ]

    const inserted = await withClient(this.#pool, (client) =>
      client.query<{ id: string }>(text, values),
    )
    const created = await this.findById(inserted.rows[0]?.id ?? '')

    if (created === undefined) throw new Error('Created user could not be read back')

    return created
  }

  async setPassword(id: string, passwordHash: string, mustChangePassword: boolean): Promise<void> {
    await withClient(this.#pool, (client) =>
      client.query(this.#setPassword, [id, passwordHash, mustChangePassword]),
    )
  }

  /** A new secret starts unconfirmed: the row only counts once a code generated from it came back. */
  async setTotpSecret(id: string, sealed: string | null): Promise<void> {
    await withClient(this.#pool, (client) => client.query(this.#clearTotp, [id, sealed]))
  }

  async confirmTotp(id: string): Promise<void> {
    await withClient(this.#pool, (client) => client.query(this.#confirmTotp, [id]))
  }

  async setRole(id: string, roleId: string): Promise<void> {
    await withClient(this.#pool, (client) => client.query(this.#setRole, [id, roleId]))
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    await withClient(this.#pool, (client) => client.query(this.#setDisabled, [id, disabled]))
  }

  async rename(id: string, username: string, displayName: string): Promise<void> {
    await withClient(this.#pool, (client) =>
      client.query(this.#rename, [id, normaliseUsername(username), displayName]),
    )
  }
}
