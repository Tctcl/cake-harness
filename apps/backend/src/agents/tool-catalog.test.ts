import { createRegistry } from '@earendil-works/pi-durable'
import { createCodingTools } from '@earendil-works/pi-durable/tools'
import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createWebExtension } from '../capabilities/web.js'
import { ToolRepository } from '../capabilities/tool-repository.js'
import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { syncToolCatalog } from './tool-catalog.js'

const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('startup tool catalog sync (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const created: string[] = []

  describe('startup tool catalog sync', () => {
    it('creates a catalog row for every registry tool without a manual request', async () => {
      const prefix = `tools_${Math.random().toString(36).slice(2, 8)}_`
      const storage = await openPostgresStorage(url, { prefix })
      created.push(...Object.values(createSchema(prefix).tables))
      try {
        const ownerId = await ensureLocalUser(storage.pool, storage.schema)
        const registry = createRegistry()
        registry.install(createCodingTools())
        registry.install(createWebExtension())
        const tools = new ToolRepository(storage.pool, storage.schema)

        await syncToolCatalog(tools, ownerId, registry.snapshot())

        expect((await tools.list(ownerId)).map((tool) => tool.name)).toEqual([
          'bash',
          'edit',
          'read',
          'web_fetch',
          'write',
        ])
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
