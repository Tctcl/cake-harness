import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSchema, openPostgresStorage } from './index.js'
import { CURRENT_SCHEMA_VERSION, LEGACY_DEFAULT_SYSTEM_PROMPT, MIGRATIONS } from './schema.js'
import {
  DEFAULT_WORKSPACE_DESCRIPTION,
  LEGACY_DEFAULT_WORKSPACE_DESCRIPTION,
} from '../../workspaces/defaults.js'

const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('Postgres migrations (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const created: string[] = []

  describe('Postgres migrations', () => {
    it('applies every migration and drops the prompt catalog and grant tables', async () => {
      const prefix = `migration_${Math.random().toString(36).slice(2, 8)}_`
      const storage = await openPostgresStorage(url, { prefix })
      const schema = createSchema(prefix)
      created.push(...Object.values(schema.tables))
      try {
        expect(CURRENT_SCHEMA_VERSION).toBe(26)
        const versions = await storage.pool.query<{ version: number }>(
          `SELECT version FROM ${schema.tables.durableSchema} ORDER BY version`,
        )
        expect(versions.rows.at(-1)?.version).toBe(26)

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

    it('updates only General’s unchanged legacy description', async () => {
      const prefix = `migration_${Math.random().toString(36).slice(2, 8)}_`
      const schema = createSchema(prefix)
      const table = schema.tables.workspaces
      created.push(table)
      const client = new Client({ connectionString: url })
      await client.connect()
      try {
        await client.query(`CREATE TABLE ${table} (
          id integer PRIMARY KEY,
          description text NOT NULL,
          is_default boolean NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`)
        await client.query(`INSERT INTO ${table} (id, description, is_default) VALUES
          (1, $1, true), (2, 'A user-authored description', true), (3, $1, false)`,
        [LEGACY_DEFAULT_WORKSPACE_DESCRIPTION])
        const migration = MIGRATIONS.find(({ version }) => version === 22)
        if (migration === undefined) throw new Error('Migration 22 is missing')
        for (const statement of migration.statements(schema)) await client.query(statement)

        const rows = await client.query<{ id: number; description: string }>(
          `SELECT id, description FROM ${table} ORDER BY id`,
        )
        expect(rows.rows).toEqual([
          { id: 1, description: DEFAULT_WORKSPACE_DESCRIPTION },
          { id: 2, description: 'A user-authored description' },
          { id: 3, description: LEGACY_DEFAULT_WORKSPACE_DESCRIPTION },
        ])
      } finally {
        await client.end()
      }
    })

    it('renames the agent prompt column and clears only the frozen starter text', async () => {
      const prefix = `migration_${Math.random().toString(36).slice(2, 8)}_`
      const schema = createSchema(prefix)
      const table = schema.tables.agents
      created.push(table)
      const client = new Client({ connectionString: url })
      await client.connect()
      try {
        await client.query(`CREATE TABLE ${table} (id integer PRIMARY KEY, system_prompt text NOT NULL)`)
        await client.query(`INSERT INTO ${table} (id, system_prompt) VALUES
          (1, $1), (2, $2), (3, '')`, [LEGACY_DEFAULT_SYSTEM_PROMPT, 'A user-authored prompt'])
        const migration = MIGRATIONS.find(({ version }) => version === 21)
        if (migration === undefined) throw new Error('Migration 21 is missing')
        for (const statement of migration.statements(schema)) await client.query(statement)

        const rows = await client.query<{ id: number; system_prompt_append: string }>(
          `SELECT id, system_prompt_append FROM ${table} ORDER BY id`,
        )
        expect(rows.rows).toEqual([
          { id: 1, system_prompt_append: '' },
          { id: 2, system_prompt_append: 'A user-authored prompt' },
          { id: 3, system_prompt_append: '' },
        ])
      } finally {
        await client.end()
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
