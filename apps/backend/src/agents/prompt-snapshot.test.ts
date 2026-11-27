import { Client } from 'pg'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { AgentRepository } from '../agents/agent-repository.js'
import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { WorkspaceRepository } from '../workspaces/workspace-repository.js'
import { PromptSnapshotRepository } from './prompt-snapshot.js'

/**
 * Runs against a real server like the other repository suites: `DATABASE_URL` must point at a disposable database, and
 * each case gets its own table prefix. Without the variable the file reports nothing instead of failing.
 */
const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('PromptSnapshotRepository (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  interface Repos {
    readonly snapshots: PromptSnapshotRepository
    readonly agents: AgentRepository
    readonly workspaces: WorkspaceRepository
    readonly ownerId: string
  }

  const withSnapshots = async (use: (repos: Repos) => Promise<void>): Promise<void> => {
    const prefix = `p${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    const { schema } = storage
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, schema)
      await use({
        snapshots: new PromptSnapshotRepository(storage.pool, schema),
        agents: new AgentRepository(storage.pool, schema),
        workspaces: new WorkspaceRepository(storage.pool, schema),
        ownerId,
      })
    } finally {
      await storage.close({} as never)
    }
  }

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

  describe('PromptSnapshotRepository', () => {
    it('keeps the text a conversation started with after the setting changes', async () => {
      await withSnapshots(async ({ snapshots }) => {
        const live = vi.fn(async () => 'the first system prompt')

        await expect(snapshots.systemPrompt(41, live)).resolves.toBe('the first system prompt')
        live.mockResolvedValue('a later system prompt')

        await expect(snapshots.systemPrompt(41, live)).resolves.toBe('the first system prompt')
        expect(live).toHaveBeenCalledTimes(1)
        // A conversation that has not started reads today's setting.
        await expect(snapshots.systemPrompt(42, live)).resolves.toBe('a later system prompt')
      })
    })

    it('freezes the append per agent, so switching back resumes the text that agent started with', async () => {
      await withSnapshots(async ({ snapshots, agents, workspaces, ownerId }) => {
        const workspace = await workspaces.create(ownerId, { name: 'Snapshot' }, 'test-image')
        const build = await agents.default(workspace.id)
        if (build === undefined) throw new Error('the workspace was created without its default agent')
        const reviewer = await agents.create(workspace.id, { name: 'Reviewer', systemPromptAppend: 'Review.' })

        await expect(snapshots.append(7, build.id, async () => 'Build as it was')).resolves.toBe('Build as it was')
        await expect(snapshots.append(7, reviewer.id, async () => 'Review.')).resolves.toBe('Review.')
        // Both agents keep their own text even though the profile is edited afterwards.
        const live = vi.fn(async () => 'Build as it is now')

        await expect(snapshots.append(7, build.id, live)).resolves.toBe('Build as it was')
        expect(live).not.toHaveBeenCalled()
        await expect(snapshots.append(8, build.id, live)).resolves.toBe('Build as it is now')
      })
    })
  })
}
