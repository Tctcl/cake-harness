import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { Pool as PostgresPool } from 'pg'

/** A value a statement may bind. */
export type Value = string | number | boolean | null | readonly (string | number)[]

/** The connection a unit of work holds. */
export type Queryable = PoolClient

/** Opens a connection, runs `work`, and returns it to the pool whatever happens. */
export const withClient = async <T>(pool: Pool, work: (client: Queryable) => Promise<T>): Promise<T> => {
	const client = await pool.connect()
	try {
		return await work(client)
	} finally {
		client.release()
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
			await client.query('ROLLBACK')
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
export const createPool = (connectionString: string, options: PoolOptions = {}): Pool =>
	new PostgresPool({ connectionString, ...options })
