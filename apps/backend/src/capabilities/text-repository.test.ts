import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { SkillRepository } from './text-repository.js'

/** Live-server suite like its neighbours: every case gets its own table prefix. */
const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('TextRepository (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  const withOwner = async (use: (skills: SkillRepository, ownerId: string) => Promise<void>): Promise<void> => {
    const prefix = `c${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, storage.schema)
      await use(new SkillRepository(storage.pool, storage.schema), ownerId)
    } finally {
      await storage.close({} as never)
    }
  }

  describe('TextRepository', () => {
    it('stores a skill and lists it by name', async () => {
      await withOwner(async (skills, ownerId) => {
        await skills.create(ownerId, { name: 'review', description: 'Read the diff', body: 'Read it carefully.' })
        await skills.create(ownerId, { name: 'brief', body: 'Keep it short.' })

        const all = await skills.list(ownerId)

        expect(all.map((entry) => entry.name)).toEqual(['brief', 'review'])
        expect(all[1]).toMatchObject({ description: 'Read the diff', body: 'Read it carefully.' })
        await expect(skills.findByName(ownerId, 'brief')).resolves.toMatchObject({ body: 'Keep it short.' })
      })
    })

    it('refuses a second entry with the same name', async () => {
      await withOwner(async (skills, ownerId) => {
        await skills.create(ownerId, { name: 'review' })

        await expect(skills.create(ownerId, { name: 'review' })).rejects.toMatchObject({
          statusCode: 409,
          code: 'NAME_TAKEN',
        })
      })
    })

    it('archives, restores and separates the two listings', async () => {
      await withOwner(async (skills, ownerId) => {
        const entry = await skills.create(ownerId, { name: 'draft', body: 'x' })

        await skills.archive(entry.id)

        expect(await skills.list(ownerId)).toEqual([])
        expect((await skills.list(ownerId, { archived: true })).map((row) => row.name)).toEqual(['draft'])

        await skills.restore(entry.id)

        expect((await skills.list(ownerId)).map((row) => row.name)).toEqual(['draft'])
      })
    })

    it('patches only what it was given and reports a missing row', async () => {
      await withOwner(async (skills, ownerId) => {
        const entry = await skills.create(ownerId, { name: 'draft', description: 'kept', body: 'old' })

        const renamed = await skills.update(entry.id, { body: 'new' })

        expect(renamed).toMatchObject({ name: 'draft', description: 'kept', body: 'new' })
        await expect(skills.update('00000000-0000-4000-8000-0000000000ff', { body: 'x' })).rejects.toMatchObject(
          { statusCode: 404 },
        )
      })
    })
  })

  afterAll(async () => {
    if (created.length === 0) return
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      for (const table of created) {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`)
      }
    } finally {
      await client.end()
    }
  })
}
