import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createPool } from '../storage/postgres/db.js'
import type { Pool } from 'pg'
import { createSchema, migrate } from '../storage/postgres/schema.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { EnvironmentRepository } from './environment-repository.js'

const url = process.env['DATABASE_URL']
const IMAGE = 'cake-harness/dev-env:dev'
const RANGE = { first: 22_000, last: 22_002 } as const

if (url === undefined) {
  describe.skip('EnvironmentRepository (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  const withRepository = async (
    use: (repository: EnvironmentRepository, ownerId: string, pool: Pool) => Promise<void>,
  ): Promise<void> => {
    const prefix = `env${run}_${caseIndex++}_`
    const schema = createSchema(prefix)
    const pool = createPool(url, { max: 2 })
    created.push(...Object.values(schema.tables))
    await migrate(pool, schema)
    const ownerId = await ensureLocalUser(pool, schema)
    try {
      await use(new EnvironmentRepository(pool, schema, RANGE), ownerId, pool)
    } finally {
      await pool.end()
    }
  }

  describe('EnvironmentRepository SSH ports', () => {
    it('allocates the lowest free port at creation, reuses a freed port, and keeps them unique', async () => {
      await withRepository(async (repository, ownerId) => {
        const first = await repository.create(ownerId, { name: 'First', image: IMAGE })
        const second = await repository.create(ownerId, { name: 'Second', image: IMAGE })
        expect(first.sshPort).toBe(22_000)
        expect(second.sshPort).toBe(22_001)

        await repository.remove(first.id)
        const third = await repository.create(ownerId, { name: 'Third', image: IMAGE })
        expect(third.sshPort).toBe(22_000)
        expect(new Set([second.sshPort, third.sshPort]).size).toBe(2)
      })
    })

    it('fails loudly when the configured range is exhausted', async () => {
      await withRepository(async (repository, ownerId) => {
        for (const name of ['One', 'Two', 'Three']) await repository.create(ownerId, { name, image: IMAGE })

        await expect(repository.create(ownerId, { name: 'Fourth', image: IMAGE })).rejects.toMatchObject({
          code: 'SSH_PORT_EXHAUSTED',
          statusCode: 503,
        })
      })
    })

    it('backfills existing rows once at startup', async () => {
      await withRepository(async (repository, ownerId, pool) => {
        const schema = createSchema(`env${run}_${caseIndex - 1}_`)
        await pool.query(
          `INSERT INTO ${schema.tables.devEnvironments} (id, owner_id, name, image) VALUES
            ('00000000-0000-4000-8000-000000000010', $1, 'Old one', $2),
            ('00000000-0000-4000-8000-000000000011', $1, 'Old two', $2)`,
          [ownerId, IMAGE],
        )

        await expect(repository.ensureSshPorts()).resolves.toBe(2)
        await expect(repository.ensureSshPorts()).resolves.toBe(0)
        const ports = (await repository.list(ownerId)).map((environment) => environment.sshPort).sort()
        expect(ports).toEqual([22_000, 22_001])
      })
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
