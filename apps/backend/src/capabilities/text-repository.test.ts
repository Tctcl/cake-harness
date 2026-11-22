import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { PromptRepository, SkillRepository } from './text-repository.js'

/**
 * Runs against a real server like the other repository suites: `DATABASE_URL` must point at a disposable database, and
 * each case gets its own table prefix. Without the variable the file reports nothing instead of failing.
 */
const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('TextRepository (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  const withOwner = async (
    use: (prompts: PromptRepository, skills: SkillRepository, ownerId: string) => Promise<void>,
  ): Promise<void> => {
    const prefix = `c${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, storage.schema)
      await use(
        new PromptRepository(storage.pool, storage.schema),
        new SkillRepository(storage.pool, storage.schema),
        ownerId,
      )
    } finally {
      await storage.close({} as never)
    }
  }

  describe('TextRepository', () => {
    it('stores a prompt and lists it by name', async () => {
      await withOwner(async (prompts, _skills, ownerId) => {
        await prompts.create(ownerId, { name: 'review', description: 'Read the diff', body: 'Read it carefully.' })
        await prompts.create(ownerId, { name: 'brief', body: 'Keep it short.' })

        const all = await prompts.list(ownerId)

        expect(all.map((entry) => entry.name)).toEqual(['brief', 'review'])
        expect(all[1]).toMatchObject({ description: 'Read the diff', body: 'Read it carefully.' })
        expect(await prompts.findByName(ownerId, 'brief')).toMatchObject({ body: 'Keep it short.' })
      })
    })

    it('refuses a second entry with the same name', async () => {
      await withOwner(async (prompts, _skills, ownerId) => {
        await prompts.create(ownerId, { name: 'review' })

        await expect(prompts.create(ownerId, { name: 'review' })).rejects.toMatchObject({
          statusCode: 409,
          code: 'NAME_TAKEN',
        })
      })
    })

    it('keeps prompts and skills apart', async () => {
      await withOwner(async (prompts, skills, ownerId) => {
        await prompts.create(ownerId, { name: 'shared', body: 'prompt text' })
        await skills.create(ownerId, { name: 'shared', body: 'skill text' })

        expect((await prompts.list(ownerId)).map((entry) => entry.body)).toEqual(['prompt text'])
        expect((await skills.list(ownerId)).map((entry) => entry.body)).toEqual(['skill text'])
      })
    })

    it('archives, restores and separates the two listings', async () => {
      await withOwner(async (prompts, _skills, ownerId) => {
        const entry = await prompts.create(ownerId, { name: 'draft', body: 'x' })

        await prompts.archive(entry.id)

        expect(await prompts.list(ownerId)).toEqual([])
        expect((await prompts.list(ownerId, { archived: true })).map((row) => row.name)).toEqual(['draft'])

        await prompts.restore(entry.id)

        expect((await prompts.list(ownerId)).map((row) => row.name)).toEqual(['draft'])
      })
    })

    it('patches only what it was given and reports a missing row', async () => {
      await withOwner(async (prompts, _skills, ownerId) => {
        const entry = await prompts.create(ownerId, { name: 'draft', description: 'kept', body: 'old' })

        const renamed = await prompts.update(entry.id, { body: 'new' })

        expect(renamed).toMatchObject({ name: 'draft', description: 'kept', body: 'new' })
        await expect(prompts.update('00000000-0000-4000-8000-0000000000ff', { body: 'x' })).rejects.toMatchObject(
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
        const drop = `DROP TABLE IF EXISTS ${table} CASCADE`
        await client.query(drop)
      }
    } finally {
      await client.end()
    }
  })
}
