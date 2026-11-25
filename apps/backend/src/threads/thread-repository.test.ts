import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID } from '../workspaces/defaults.js'
import { ensureLocalUser } from './local-user.js'
import { ThreadRepository } from './thread-repository.js'
import type { ThreadTarget } from './thread-repository.js'

/**
 * Runs against a real server like the storage suite: `DATABASE_URL` must point at a disposable database, and each case
 * gets its own table prefix. Without the variable the file reports nothing instead of failing, because the gates must
 * pass on a machine with no Postgres.
 */
const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('ThreadRepository (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  // Migration v4 seeds this pair, so every case can file threads against it without creating a workspace first.
  const TARGET: ThreadTarget = { workspaceId: DEFAULT_WORKSPACE_ID, agentId: DEFAULT_AGENT_ID }

  const withThreads = async (
    use: (threads: ThreadRepository, ownerId: string) => Promise<void>,
  ): Promise<void> => {
    const prefix = `t${run}_${caseIndex++}_`
    // Opening the storage migrates both sets of tables, so the case needs no DDL of its own.
    const storage = await openPostgresStorage(url, { prefix })
    const { schema } = storage
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, schema)
      await use(new ThreadRepository(storage.pool, schema), ownerId)
    } finally {
      await storage.close({} as never)
    }
  }

  describe('ThreadRepository', () => {
    it('records a thread for a durable conversation', async () => {
      await withThreads(async (threads, ownerId) => {
        const thread = await threads.create(ownerId, 7, TARGET, 'First')

        expect(thread.durableConversationId).toBe(7)
        expect(thread.title).toBe('First')
        expect(thread.workspaceId).toBe(DEFAULT_WORKSPACE_ID)
        expect(thread.agentId).toBe(DEFAULT_AGENT_ID)
        expect(thread.overrides).toEqual({ credentialId: null, modelId: null, thinkingLevel: null })
        await expect(threads.find(thread.id)).resolves.toMatchObject({ id: thread.id })
        await expect(threads.list(ownerId)).resolves.toHaveLength(1)
      })
    })

    it('updates and clears individual run setting overrides', async () => {
      await withThreads(async (threads, ownerId) => {
        const thread = await threads.create(ownerId, 8, TARGET)

        const changed = await threads.updateRunSettings(thread.id, { modelId: 'kimi-k3', thinkingLevel: 'high' })
        expect(changed?.overrides).toEqual({ credentialId: null, modelId: 'kimi-k3', thinkingLevel: 'high' })

        const cleared = await threads.updateRunSettings(thread.id, { modelId: null })
        expect(cleared?.overrides).toEqual({ credentialId: null, modelId: null, thinkingLevel: 'high' })
        await expect(threads.updateRunSettings(thread.id, {})).resolves.toEqual(cleared)
      })
    })

    it('refuses a thread whose owner does not exist', async () => {
      await withThreads(async (threads) => {
        await expect(
          threads.create('00000000-0000-4000-8000-00000000dead', 1, TARGET),
        ).rejects.toThrow(/foreign key/)
      })
    })

    it('refuses a second thread for the same conversation', async () => {
      await withThreads(async (threads, ownerId) => {
        await threads.create(ownerId, 11, TARGET)

        await expect(threads.create(ownerId, 11, TARGET)).rejects.toThrow(/duplicate key/)
      })
    })

    it('orders threads by the last change', async () => {
      await withThreads(async (threads, ownerId) => {
        const first = await threads.create(ownerId, 1, TARGET, 'First')
        const second = await threads.create(ownerId, 2, TARGET, 'Second')
        expect((await threads.list(ownerId)).map((thread) => thread.id)).toEqual([
          second.id,
          first.id,
        ])

        // Both rows are inserted in the same transaction-free sequence, so `updated_at` ties unless renaming moves one.
        await threads.rename(first.id, 'Renamed')

        expect((await threads.list(ownerId)).map((thread) => thread.id)).toEqual([
          first.id,
          second.id,
        ])
      })
    })

    it('answers undefined when renaming an unknown thread', async () => {
      await withThreads(async (threads) => {
        await expect(threads.rename('00000000-0000-4000-8000-00000000beef', 'x')).resolves.toBeUndefined()
      })
    })

    it('archives a thread out of the listing and restores it', async () => {
      await withThreads(async (threads, ownerId) => {
        const thread = await threads.create(ownerId, 3, TARGET)

        const archived = await threads.archive(thread.id)
        expect(archived?.archivedAt).toBeInstanceOf(Date)
        await expect(threads.list(ownerId)).resolves.toHaveLength(0)
        await expect(threads.list(ownerId, { archived: true })).resolves.toHaveLength(1)
        // Archiving twice keeps the first stamp: the second call is a no-op rather than a clock reading.
        await expect(threads.archive(thread.id)).resolves.toMatchObject({
          archivedAt: archived?.archivedAt,
        })

        const restored = await threads.restore(thread.id)
        expect(restored?.archivedAt).toBeNull()
        await expect(threads.list(ownerId)).resolves.toHaveLength(1)
        await expect(threads.list(ownerId, { archived: true })).resolves.toHaveLength(0)
      })
    })

    it('refuses to remove a live thread', async () => {
      await withThreads(async (threads, ownerId) => {
        const thread = await threads.create(ownerId, 3, TARGET)

        await expect(threads.remove(thread.id)).rejects.toMatchObject({
          code: 'THREAD_NOT_ARCHIVED',
          statusCode: 409,
        })
      })
    })

    it('removes an archived thread once', async () => {
      await withThreads(async (threads, ownerId) => {
        const thread = await threads.create(ownerId, 3, TARGET)
        await threads.archive(thread.id)

        await expect(threads.remove(thread.id)).resolves.toBe(true)
        await expect(threads.remove(thread.id)).resolves.toBe(false)
        await expect(threads.find(thread.id)).resolves.toBeUndefined()
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
