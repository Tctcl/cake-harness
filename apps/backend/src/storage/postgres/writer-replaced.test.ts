import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { ConversationId, StorageWrite } from '@earendil-works/pi-durable'
import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { createSchema, openPostgresStorage, WriterReplacedError } from './index.js'
import type { PostgresStorage } from './storage.js'

/** Same gate as `storage.test.ts`: the gates must pass on a machine with no Postgres. */
const url = process.env['DATABASE_URL']

const conversation = async (storage: PostgresStorage): Promise<StorageWrite[]> => [
  { type: 'conversation', value: { id: await storage.mintId<ConversationId>() } },
]

if (url === undefined) {
  describe.skip('PostgresStorage writer fencing (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  const prefix = `w${run}_`
  const racePrefix = `r${run}_`

  afterAll(async () => {
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      for (const table of [...Object.values(createSchema(prefix).tables), ...Object.values(createSchema(racePrefix).tables)]) {
        // Table names come from `createSchema` over this file's own prefixes.
        const drop = `DROP TABLE IF EXISTS ${table} CASCADE`
        await client.query(drop)
      }
    } finally {
      await client.end()
    }
  })

  describe('PostgresStorage writer fencing', () => {
    it('lets two processes open a fresh database at once', async () => {
      const opened = await Promise.all([
        openPostgresStorage(url, { prefix: racePrefix }),
        openPostgresStorage(url, { prefix: racePrefix }),
      ])
      await Promise.all(opened.map((storage) => storage.close(BACKGROUND_CONTEXT)))
    })

    it('refuses commits from an open that a later open replaced, and the later one mints past them', async () => {
      const older = await openPostgresStorage(url, { prefix })
      try {
        const first = await conversation(older)
        await expect(older.commit([first], () => {}, BACKGROUND_CONTEXT)).resolves.toEqual({ stored: 1 })

        const newer = await openPostgresStorage(url, { prefix })
        try {
          await expect(older.commit([await conversation(older)], () => {}, BACKGROUND_CONTEXT)).rejects.toBeInstanceOf(
            WriterReplacedError,
          )

          const next = await conversation(newer)
          await expect(newer.commit([next], () => {}, BACKGROUND_CONTEXT)).resolves.toEqual({ stored: 1 })
          const [firstWrite] = first
          const [nextWrite] = next
          if (firstWrite?.type !== 'conversation' || nextWrite?.type !== 'conversation') {
            throw new Error('expected conversation writes')
          }
          expect(nextWrite.value.id).toBeGreaterThan(firstWrite.value.id)
        } finally {
          await newer.close(BACKGROUND_CONTEXT)
        }
      } finally {
        await older.close(BACKGROUND_CONTEXT)
      }
    })
  })
}
