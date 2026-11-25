import { randomUUID } from 'node:crypto'

import type { Pool } from 'pg'

import { withClient } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/** A signed-in browser. The token itself is never stored, only the hash the cookie is looked up by. */
export interface SessionRecord {
  readonly id: string
  readonly userId: string
  /** `null` while the password is known and the second factor is not: such a session may finish signing in, nothing else. */
  readonly authenticatedAt: Date | null
  readonly lastSeenAt: Date
  readonly expiresAt: Date
}

interface SessionRow {
  readonly id: string
  readonly user_id: string
  readonly authenticated_at: Date | null
  readonly last_seen_at: Date
  readonly expires_at: Date
}

const toSession = (row: SessionRow): SessionRecord => ({
  id: row.id,
  userId: row.user_id,
  authenticatedAt: row.authenticated_at,
  lastSeenAt: row.last_seen_at,
  expiresAt: row.expires_at,
})

export class SessionRepository {
  readonly #pool: Pool
  readonly #insert: string
  readonly #byToken: string
  readonly #authenticate: string
  readonly #touch: string
  readonly #remove: string
  readonly #removeForUser: string
  readonly #removeAll: string

  constructor(pool: Pool, schema: PostgresSchema) {
    const { sessions } = schema.tables
    this.#pool = pool
    this.#insert = `INSERT INTO ${sessions} (id, user_id, token_hash, authenticated_at, expires_at)
      VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)
      RETURNING id, user_id, authenticated_at, last_seen_at, expires_at`
    this.#byToken = `SELECT id, user_id, authenticated_at, last_seen_at, expires_at FROM ${sessions}
      WHERE token_hash = $1 AND expires_at > now()`
    this.#authenticate = `UPDATE ${sessions} SET authenticated_at = now() WHERE id = $1`
    // A write per request would be a row version per request; a minute of staleness is plenty for an expiry measured
    // in days.
    this.#touch = `UPDATE ${sessions} SET last_seen_at = now()
      WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`
    this.#remove = `DELETE FROM ${sessions} WHERE id = $1`
    this.#removeForUser = `DELETE FROM ${sessions} WHERE user_id = $1 AND id <> $2`
    this.#removeAll = `DELETE FROM ${sessions}`
  }

  async create(tokenHash: string, userId: string, ttlMs: number, authenticated: boolean): Promise<SessionRecord> {
    const values = [randomUUID(), userId, tokenHash, authenticated ? new Date() : null, ttlMs]
    const rows = await withClient(this.#pool, (client) => client.query<SessionRow>(this.#insert, values))
    const row = rows.rows[0]

    if (row === undefined) throw new Error('Created session could not be read back')

    return toSession(row)
  }

  /** Expired sessions are not found, so a cookie that outlives its row signs nobody in. */
  async findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    const rows = await withClient(this.#pool, (client) => client.query<SessionRow>(this.#byToken, [tokenHash]))
    const row = rows.rows[0]

    return row === undefined ? undefined : toSession(row)
  }

  async markAuthenticated(id: string): Promise<void> {
    await withClient(this.#pool, (client) => client.query(this.#authenticate, [id]))
  }

  async touch(id: string): Promise<void> {
    await withClient(this.#pool, (client) => client.query(this.#touch, [id]))
  }

  async remove(id: string): Promise<void> {
    await withClient(this.#pool, (client) => client.query(this.#remove, [id]))
  }

  /**
   * Disabling someone, changing their password or setting their role ends their sessions: an old cookie must not keep
   * the permissions it was issued under. `except` is the session making the change, which stays signed in.
   */
  async removeForUser(userId: string, except: { readonly sessionId?: string | undefined } = {}): Promise<void> {
    await withClient(this.#pool, (client) => client.query(this.#removeForUser, [userId, except.sessionId ?? '']))
  }

  /** Both directions of the single-user switch change what a live cookie means, so none of them survive it. */
  async removeAll(): Promise<void> {
    await withClient(this.#pool, (client) => client.query(this.#removeAll))
  }
}
