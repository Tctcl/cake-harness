import type { Queryable, Value } from './db.js'

/** Postgres binds at most 65535 parameters per statement; 500 rows of at most nine columns stay well inside. */
const ROWS_PER_STATEMENT = 500

/**
 * Inserts `rows` into `table` in as few statements as possible. Unlike the SQLite backend there is no need to smuggle
 * rows through one JSON parameter: the parameter limit is per statement and the chunks are sized under it.
 */
export const insertRows = async (
  client: Queryable,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly Value[])[],
  conflict?: string,
): Promise<void> => {
  for (let start = 0; start < rows.length; start += ROWS_PER_STATEMENT) {
    const chunk = rows.slice(start, start + ROWS_PER_STATEMENT)
    const params: Value[] = []
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value)
        return `$${params.length}`
      })
      return `(${placeholders.join(', ')})`
    })
    const values = tuples.join(', ')
    const suffix = conflict === undefined ? '' : ` ${conflict}`
    // Identifiers come from `createSchema`; the row values and `conflict` text are this module's literals.
    const text = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${values}${suffix}`
    await client.query(text, params)
  }
}

/** Deletes each ID in `ids` from `table`'s `column`. */
export const deleteForIds = async (
  client: Queryable,
  table: string,
  column: string,
  ids: readonly number[],
): Promise<void> => {
  if (ids.length === 0) return
  const text = `DELETE FROM ${table} WHERE ${column} = ANY($1::bigint[])`
  await client.query(text, [[...ids]])
}
