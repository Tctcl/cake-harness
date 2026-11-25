import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSchema, openPostgresStorage } from './index.js'
import { CURRENT_SCHEMA_VERSION } from './schema.js'

const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('Postgres migrations (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const created: string[] = []

  describe('Postgres migrations', () => {
    it('applies version 20 and drops the prompt catalog and grant tables', async () => {
      const prefix = `migration_${Math.random().toString(36).slice(2, 8)}_`
      const storage = await openPostgresStorage(url, { prefix })
      const schema = createSchema(prefix)
      created.push(...Object.values(schema.tables))
      try {
        expect(CURRENT_SCHEMA_VERSION).toBe(20)
        const versions = await storage.pool.query<{ version: number }>(
          `SELECT version FROM ${schema.tables.durableSchema} ORDER BY version`,
        )
        expect(versions.rows.at(-1)?.version).toBe(20)

        for (const table of [schema.tables.prompts, schema.tables.workspacePrompts, schema.tables.agentPrompts]) {
          const result = await storage.pool.query<{ table_name: string | null }>(
            'SELECT to_regclass($1) AS table_name',
            [table],
          )
          expect(result.rows[0]?.table_name).toBeNull()
        }
      } finally {
        await storage.close({} as never)
      }
    })
  })

  afterAll(async () => {
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      for (const table of created) await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`)
    } finally {
      await client.end()
    }
  })
}
