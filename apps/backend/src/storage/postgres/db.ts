import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { Pool as PostgresPool } from 'pg'

import { isTransient } from './retry.js'

/** A value a statement may bind. */
export type Value = string | number | boolean | null | readonly (string | number)[]

/** The connection a unit of work holds. */
export type Queryable = PoolClient

/**
 * Opens a connection, runs `work`, and returns it to the pool whatever happens.
 *
 * A client whose connection was lost is destroyed rather than parked: `pg` does not probe a pooled connection before
 * handing it out, so a dead socket put back in the idle list fails the next caller with an error it cannot describe.
 */
export const withClient = async <T>(pool: Pool, work: (client: Queryable) => Promise<T>): Promise<T> => {
  const client = await pool.connect()
  let failure: unknown
  try {
    return await work(client)
  } catch (error) {
    failure = error
    throw error
  } finally {
    if (isTransient(failure)) {
      // `release` with an error (or `true`) removes the client instead of returning it.
      client.release(failure instanceof Error ? failure : true)
    } else {
      client.release()
    }
  }
}

/** Runs `work` in a transaction: commits on return, rolls back on throw. */
export const withTransaction = async <T>(
  pool: Pool,
  work: (client: Queryable) => Promise<T>,
  options: { readOnly?: boolean } = {},
): Promise<T> =>
  withClient(pool, async (client) => {
    // A read-only transaction pins one snapshot for its several queries; a write transaction takes the default mode.
    const begin = options.readOnly === true ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'
    await client.query(begin)
    try {
      const result = await work(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      // A rollback fails exactly when the connection died, which is the failure already on its way out; reporting it
      // would replace the reason the transaction was abandoned.
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  })

/** Binds `values` and returns the rows. */
export const rowsOf = async <R extends QueryResultRow>(
  client: Queryable,
  text: string,
  values: readonly Value[] = [],
): Promise<R[]> => (await client.query<R>(text, [...values])).rows

export interface PoolOptions {
  /** Upper bound on concurrent connections; node-postgres defaults to 10. */
  readonly max?: number
}

/** Creates the pool this storage owns. */
export const createPool = (connectionString: string, options: PoolOptions = {}): Pool => {
  const pool = new PostgresPool({ connectionString, ...options })

  // `pg` re-emits an idle connection's death on the pool, and Node treats an unhandled 'error' event as fatal. There is
  // no caller to fail here: the pool discards the dead client, and the next statement either runs on a fresh connection
  // or fails into the retry policy in `resilient.ts`, which is where a failure belongs.
  pool.on('error', () => undefined)

  return pool
}
