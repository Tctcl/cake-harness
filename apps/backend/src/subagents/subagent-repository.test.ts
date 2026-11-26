import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { AgentRepository } from '../agents/agent-repository.js'
import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { WorkspaceRepository } from '../workspaces/workspace-repository.js'
import { SubagentRepository } from './subagent-repository.js'

const url = process.env['DATABASE_URL']
const IMAGE = 'cake-harness/dev-env:dev'

if (url === undefined) {
  describe.skip('SubagentRepository (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  const withSubagents = async (
    use: (repos: {
      readonly subagents: SubagentRepository
      readonly agents: AgentRepository
      readonly workspaces: WorkspaceRepository
      readonly ownerId: string
    }) => Promise<void>,
  ): Promise<void> => {
    const prefix = `sub${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    const { schema } = storage
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, schema)
      const agents = new AgentRepository(storage.pool, schema)
      await use({
        subagents: new SubagentRepository(storage.pool, schema, agents),
        agents,
        workspaces: new WorkspaceRepository(storage.pool, schema),
        ownerId,
      })
    } finally {
      await storage.close({} as never)
    }
  }

  describe('SubagentRepository', () => {
    it('creates, lists and edits a profile with model choices and callable parents', async () => {
      await withSubagents(async ({ subagents, agents, workspaces, ownerId }) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        const parent = await agents.default(workspace.id)
        if (parent === undefined) throw new Error('the seeded parent is missing')
        const created = await subagents.create(workspace.id, {
          name: 'Reviewer',
          description: 'Reviews a narrow change',
          allowAll: false,
          systemPromptAppend: 'Review, do not edit.',
          instructions: 'Report file paths.',
          modelId: 'deepseek-v4.1-flash',
          thinkingLevel: 'medium',
          allowedModels: ['deepseek-v4.1-flash', 'kimi-k3'],
          callableBy: [parent.id],
        })

        expect(created).toMatchObject({
          workspaceId: workspace.id,
          name: 'Reviewer',
          modelId: 'deepseek-v4.1-flash',
          thinkingLevel: 'medium',
          allowedModels: ['deepseek-v4.1-flash', 'kimi-k3'],
          callableBy: [parent.id],
        })
        await expect(subagents.list(workspace.id)).resolves.toMatchObject([{ id: created.id }])
        await expect(agents.list(workspace.id)).resolves.toHaveLength(2)
        await expect(subagents.callableBy(parent.id)).resolves.toEqual([{
          id: created.id,
          name: 'Reviewer',
          description: 'Reviews a narrow change',
          modelId: 'deepseek-v4.1-flash',
          thinkingLevel: 'medium',
          allowedModels: ['deepseek-v4.1-flash', 'kimi-k3'],
        }])

        const updated = await subagents.update(created.id, {
          modelId: 'kimi-k3',
          thinkingLevel: 'high',
          callableBy: [],
        })
        expect(updated).toMatchObject({ modelId: 'kimi-k3', thinkingLevel: 'high', callableBy: [] })
        await expect(subagents.callableBy(parent.id)).resolves.toEqual([])
      })
    })

    it('enforces same-workspace live ordinary callers and hides archived subagents', async () => {
      await withSubagents(async ({ subagents, agents, workspaces, ownerId }) => {
        const first = await workspaces.create(ownerId, { name: 'First' }, IMAGE)
        const second = await workspaces.create(ownerId, { name: 'Second' }, IMAGE)
        const parent = await agents.default(first.id)
        const otherParent = await agents.default(second.id)
        if (parent === undefined || otherParent === undefined) throw new Error('seeded parents are missing')
        const subagent = await subagents.create(first.id, {
          name: 'Explorer',
          modelId: 'deepseek-v4.1-flash',
          allowedModels: ['deepseek-v4.1-flash'],
          callableBy: [parent.id],
        })

        await expect(subagents.create(first.id, {
          name: 'Invalid',
          modelId: 'deepseek-v4.1-flash',
          allowedModels: ['deepseek-v4.1-flash'],
          callableBy: [otherParent.id],
        })).rejects.toMatchObject({ code: 'SUBAGENT_CALLER_INVALID', statusCode: 400 })
        await expect(subagents.create(first.id, {
          name: 'Also invalid',
          modelId: 'deepseek-v4.1-flash',
          allowedModels: ['deepseek-v4.1-flash'],
          callableBy: [subagent.id],
        })).rejects.toMatchObject({ code: 'SUBAGENT_CALLER_INVALID' })

        await subagents.archive(subagent.id)
        await expect(subagents.callableBy(parent.id)).resolves.toEqual([])
        await expect(subagents.list(first.id)).resolves.toEqual([])
        await expect(subagents.list(first.id, { archived: true })).resolves.toMatchObject([{ id: subagent.id }])
        await subagents.restore(subagent.id)
        await expect(subagents.callableBy(parent.id)).resolves.toHaveLength(1)
        await subagents.archive(subagent.id)
        await expect(subagents.remove(subagent.id)).resolves.toBe(true)
        await expect(subagents.find(subagent.id)).resolves.toBeUndefined()
      })
    })

    it('enforces the default-model membership invariant in Postgres', async () => {
      await withSubagents(async ({ subagents, workspaces, ownerId }) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)

        await expect(subagents.create(workspace.id, {
          name: 'Broken',
          modelId: 'kimi-k3',
          allowedModels: ['deepseek-v4.1-flash'],
        })).rejects.toThrow(/subagent_model_settings/)
      })
    })
  })

  afterAll(async () => {
    if (created.length === 0) return
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      for (const table of created) await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`)
    } finally {
      await client.end()
    }
  })
}
