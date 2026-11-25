import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { CredentialRepository } from './credential-repository.js'

/** Runs against a real server like the other repository suites; without `DATABASE_URL` it reports nothing. */
const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('CredentialRepository (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  const withCredentials = async (
    use: (credentials: CredentialRepository, ownerId: string) => Promise<void>,
  ): Promise<void> => {
    const prefix = `k${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    const { schema } = storage
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, schema)
      await use(new CredentialRepository(storage.pool, schema), ownerId)
    } finally {
      await storage.close({} as never)
    }
  }

  describe('CredentialRepository', () => {
    it('records a provider key with its account and no expiry', async () => {
      await withCredentials(async (credentials, ownerId) => {
        const created = await credentials.create(ownerId, {
          kind: 'opencode-go',
          name: 'work',
          value: 'sk-live-1',
          email: 'me@example.com',
        })

        expect(created).toMatchObject({
          kind: 'opencode-go',
          name: 'work',
          email: 'me@example.com',
          mcpId: null,
          note: null,
          expiresAt: null,
        })
        // The secret is written once: it is not part of what the list returns.
        expect(created).not.toHaveProperty('value')
      })
    })

    it('records an mcp key against the id it answers for', async () => {
      await withCredentials(async (credentials, ownerId) => {
        await credentials.create(ownerId, {
          kind: 'mcp',
          name: 'github-pat',
          value: 'ghp_1',
          mcpId: 'github',
          note: 'personal token',
          expiresAt: '2026-12-31T23:59:59.999Z',
        })

        const [stored] = await credentials.list(ownerId)

        expect(stored).toMatchObject({ kind: 'mcp', mcpId: 'github', note: 'personal token' })
        expect(stored?.expiresAt).toBe('2026-12-31T23:59:59.999Z')
      })
    })

    it('lists newest first and removes only the key it was given', async () => {
      await withCredentials(async (credentials, ownerId) => {
        const first = await credentials.create(ownerId, {
          kind: 'opencode-go',
          name: 'first',
          value: 'a',
          email: 'me@example.com',
        })
        const second = await credentials.create(ownerId, {
          kind: 'mcp',
          name: 'second',
          value: 'b',
          mcpId: 'github',
        })

        await expect(credentials.list(ownerId)).resolves.toMatchObject([{ id: second.id }, { id: first.id }])

        await expect(credentials.remove(ownerId, second.id)).resolves.toBe(true)
        await expect(credentials.remove(ownerId, second.id)).resolves.toBe(false)
        await expect(credentials.list(ownerId)).resolves.toMatchObject([{ id: first.id }])
      })
    })

    it('refuses a row whose fields do not match its kind', async () => {
      await withCredentials(async (credentials, ownerId) => {
        // The table's check is the last word: an mcp key without a server id is not a row anybody can write.
        await expect(
          credentials.create(ownerId, { kind: 'mcp', name: 'nameless', value: 'c' }),
        ).rejects.toThrow()
      })
    })
  })

  afterAll(async () => {
    if (created.length === 0) return
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      for (const table of created) {
        const drop = `DROP TABLE IF EXISTS ${table} CASCADE`
        await client.query(drop)
      }
    } finally {
      await client.end()
    }
  })
}
