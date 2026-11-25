import type { Pool } from 'pg'

import { withClient } from '../storage/postgres/db.js'
import type { PostgresSchema } from '../storage/postgres/schema.js'

/**
 * The owner every thread belongs to until there is authentication. A fixed id rather than a random one: a restart must
 * find the row it seeded, not add another user.
 */
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001'

/** The display name the seeded row carries; the schema migration writes the same value. */
export const LOCAL_USER_NAME = 'Local user'

/**
 * Create the single local user if it is missing. Until sign-in exists there is exactly one, so this is idempotent rather
 * than a user-management operation: callers get the id to own threads with and never list users.
 */
export const ensureLocalUser = async (pool: Pool, schema: PostgresSchema): Promise<string> => {
  const text = `INSERT INTO ${schema.tables.users} (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`
  await withClient(pool, async (client) => {
    await client.query(text, [LOCAL_USER_ID, LOCAL_USER_NAME])
  })

  return LOCAL_USER_ID
}
