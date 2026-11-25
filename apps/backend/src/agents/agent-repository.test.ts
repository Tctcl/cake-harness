import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { ThreadRepository } from '../threads/thread-repository.js'
import { DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID } from '../workspaces/defaults.js'
import type { Workspace } from '../workspaces/workspace-repository.js'
import { WorkspaceRepository } from '../workspaces/workspace-repository.js'
import { AgentRepository } from './agent-repository.js'
import { DEFAULT_SYSTEM_PROMPT } from './default-prompt.js'

/**
 * Runs against a real server like the other repository suites: `DATABASE_URL` must point at a disposable database, and
 * each case gets its own table prefix. Without the variable the file reports nothing instead of failing.
 */
/** The image a workspace records until its container is first started. */
const IMAGE = 'cake-harness/dev-env:dev'

const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('AgentRepository (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  interface Repos {
    readonly agents: AgentRepository
    readonly workspaces: WorkspaceRepository
    readonly threads: ThreadRepository
    readonly ownerId: string
  }

  const withAgents = async (use: (repos: Repos) => Promise<void>): Promise<void> => {
    const prefix = `a${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    const { schema } = storage
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, schema)
      await use({
        agents: new AgentRepository(storage.pool, schema),
        workspaces: new WorkspaceRepository(storage.pool, schema),
        threads: new ThreadRepository(storage.pool, schema),
        ownerId,
      })
    } finally {
      await storage.close({} as never)
    }
  }

  const otherWorkspace = (workspaces: WorkspaceRepository, ownerId: string): Promise<Workspace> =>
    workspaces.create(ownerId, { name: 'Platform' }, IMAGE)

  describe('AgentRepository', () => {
    it('lists the seeded default agent with everything enabled and the starter prompt', async () => {
      await withAgents(async ({ agents }) => {
        const all = await agents.list(DEFAULT_WORKSPACE_ID)

        expect(all).toHaveLength(1)
        expect(all[0]).toMatchObject({
          id: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          isDefault: true,
          allowAll: true,
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          instructions: '',
        })
        await expect(agents.default(DEFAULT_WORKSPACE_ID)).resolves.toMatchObject({
          id: DEFAULT_AGENT_ID,
        })
      })
    })

    it('gives a new workspace a default agent with the starter prompt', async () => {
      await withAgents(async ({ agents, workspaces, ownerId }) => {
        const workspace = await otherWorkspace(workspaces, ownerId)

        await expect(agents.default(workspace.id)).resolves.toMatchObject({ systemPrompt: DEFAULT_SYSTEM_PROMPT })
      })
    })

    it('records a profile with its own instructions', async () => {
      await withAgents(async ({ agents, workspaces, ownerId }) => {
        const workspace = await otherWorkspace(workspaces, ownerId)

        const agent = await agents.create(workspace.id, {
          name: 'Reviewer',
          allowAll: false,
          systemPrompt: 'You review code.',
          instructions: 'Never edit.',
        })

        expect(agent).toMatchObject({
          workspaceId: workspace.id,
          name: 'Reviewer',
          isDefault: false,
          allowAll: false,
          systemPrompt: 'You review code.',
          instructions: 'Never edit.',
        })
      })
    })

    it('narrows an existing agent', async () => {
      await withAgents(async ({ agents, workspaces, ownerId }) => {
        const workspace = await otherWorkspace(workspaces, ownerId)
        const agent = await agents.create(workspace.id, { name: 'Reviewer' })

        expect(agent.allowAll).toBe(true)
        await expect(agents.update(agent.id, { allowAll: false })).resolves.toMatchObject({
          allowAll: false,
        })
      })
    })

    it('edits the default agent like any other, run settings included', async () => {
      await withAgents(async ({ agents }) => {
        const edited = await agents.update(DEFAULT_AGENT_ID, {
          name: 'Assistant',
          modelId: 'kimi-k3',
          thinkingLevel: 'high',
        })

        expect(edited).toMatchObject({ name: 'Assistant', modelId: 'kimi-k3', thinkingLevel: 'high', credentialId: null })
        // null hands the model back to the default.
        await expect(agents.update(DEFAULT_AGENT_ID, { modelId: null })).resolves.toMatchObject({ modelId: null })
      })
    })

    it('refuses to archive or delete the default agent', async () => {
      await withAgents(async ({ agents }) => {
        await expect(agents.archive(DEFAULT_AGENT_ID)).rejects.toMatchObject({
          code: 'AGENT_IMMUTABLE',
          statusCode: 403,
        })
        await expect(agents.archive(DEFAULT_AGENT_ID)).rejects.toMatchObject({
          code: 'AGENT_IMMUTABLE',
        })
        await expect(agents.restore(DEFAULT_AGENT_ID)).rejects.toMatchObject({
          code: 'AGENT_IMMUTABLE',
        })
        await expect(agents.remove(DEFAULT_AGENT_ID)).rejects.toMatchObject({
          code: 'AGENT_IMMUTABLE',
        })
      })
    })

    it('archives an agent with its threads and restores only the agent', async () => {
      await withAgents(async ({ agents, workspaces, threads, ownerId }) => {
        const workspace = await otherWorkspace(workspaces, ownerId)
        const agent = await agents.create(workspace.id, { name: 'Reviewer' })
        const thread = await threads.create(ownerId, 1, {
          workspaceId: workspace.id,
          agentId: agent.id,
        })

        const archived = await agents.archive(agent.id)
        expect(archived?.archivedAt).toBeInstanceOf(Date)
        // The workspace's own default agent stays live; the archived listing holds this one alone.
        await expect(agents.list(workspace.id)).resolves.toMatchObject([{ name: 'Assistant', isDefault: true }])
        await expect(agents.list(workspace.id, { archived: true })).resolves.toMatchObject([
          { id: agent.id },
        ])
        await expect(threads.list(ownerId)).resolves.toHaveLength(0)

        const restored = await agents.restore(agent.id)
        expect(restored?.archivedAt).toBeNull()
        await expect(agents.list(workspace.id)).resolves.toMatchObject([{ name: 'Assistant' }, { id: agent.id }])
        await expect(threads.list(ownerId)).resolves.toHaveLength(0)
        await expect(threads.list(ownerId, { archived: true })).resolves.toMatchObject([
          { id: thread.id },
        ])
      })
    })

    it('refuses to remove a live agent', async () => {
      await withAgents(async ({ agents, workspaces, ownerId }) => {
        const workspace = await otherWorkspace(workspaces, ownerId)
        const agent = await agents.create(workspace.id, { name: 'Reviewer' })

        await expect(agents.remove(agent.id)).rejects.toMatchObject({
          code: 'AGENT_NOT_ARCHIVED',
          statusCode: 409,
        })
      })
    })

    it('refuses to remove an archived agent holding a thread restored on its own', async () => {
      await withAgents(async ({ agents, workspaces, threads, ownerId }) => {
        const workspace = await otherWorkspace(workspaces, ownerId)
        const agent = await agents.create(workspace.id, { name: 'Reviewer' })
        const thread = await threads.create(ownerId, 1, {
          workspaceId: workspace.id,
          agentId: agent.id,
        })

        await agents.archive(agent.id)
        await threads.restore(thread.id)

        await expect(agents.remove(agent.id)).rejects.toMatchObject({
          code: 'AGENT_IN_USE',
          statusCode: 409,
        })
      })
    })

    it('refuses to add or edit an agent in an archived workspace', async () => {
      await withAgents(async ({ agents, workspaces, ownerId }) => {
        const workspace = await otherWorkspace(workspaces, ownerId)
        const agent = await agents.create(workspace.id, { name: 'Reviewer' })
        await workspaces.archive(workspace.id)

        await expect(agents.create(workspace.id, { name: 'Other' })).rejects.toMatchObject({
          code: 'WORKSPACE_ARCHIVED',
          statusCode: 409,
        })
        await expect(agents.update(agent.id, { name: 'Other' })).rejects.toMatchObject({
          code: 'WORKSPACE_ARCHIVED',
        })
      })
    })

    it('deletes an archived agent and answers undefined afterwards', async () => {
      await withAgents(async ({ agents, workspaces, ownerId }) => {
        const workspace = await otherWorkspace(workspaces, ownerId)
        const agent = await agents.create(workspace.id, { name: 'Reviewer' })
        await agents.archive(agent.id)

        await expect(agents.remove(agent.id)).resolves.toBe(true)
        await expect(agents.remove(agent.id)).resolves.toBe(false)
        await expect(agents.find(agent.id)).resolves.toBeUndefined()
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
