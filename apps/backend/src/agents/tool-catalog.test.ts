import { createRegistry } from '@earendil-works/pi-durable'
import { createCodemodeExtension } from '@earendil-works/pi-durable/codemode'
import { createCodingTools } from '@earendil-works/pi-durable/tools'
import { CodemodeSandbox } from '@earendil-works/pi-codemode'
import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createAskUserExtension } from '../capabilities/ask-user.js'
import { createWebExtension } from '../capabilities/web.js'
import { createReadonlyToolsExtension } from '../capabilities/readonly-tools.js'
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
        const sandbox = new CodemodeSandbox({ memoryLimitBytes: 256 * 1024 * 1024 })
        registry.install(createCodingTools())
        registry.install(createReadonlyToolsExtension())
        registry.install(createWebExtension())
        registry.install(createCodemodeExtension({ sandbox, models: false }))
        registry.install(createAskUserExtension())
        const tools = new ToolRepository(storage.pool, storage.schema)

        try {
          expect(registry.snapshot().tools().map(({ tool }) => tool.name)).toContain('codemode')
          await syncToolCatalog(tools, ownerId, registry.snapshot())

          expect((await tools.list(ownerId)).map((tool) => tool.name)).toEqual([
            'ask_user',
            'bash',
            'codemode',
            'edit',
            'find',
            'git',
            'grep',
            'ls',
            'read',
            'web_fetch',
            'write',
          ])
        } finally {
          await sandbox.close()
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
