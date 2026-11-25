import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { AgentRepository } from '../agents/agent-repository.js'
import { WorkspaceRepository } from '../workspaces/workspace-repository.js'
import { createCapabilityApi } from './api.js'
import type { CapabilityApi } from './api.js'
import { CapabilityLinks } from './capability-links.js'
import { WorkspaceMcpServerRepository } from './mcp-repository.js'
import { PromptRepository, SkillRepository } from './text-repository.js'
import { ToolRepository } from './tool-repository.js'

/** Live-server suite like its neighbours: `DATABASE_URL` names a disposable database, and every case gets a prefix. */
/** The image a workspace records until its container is first started. */
const IMAGE = 'tctcl/dev-env:dev'

const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('CapabilityApi (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  const withApi = async (
    use: (world: {
      api: CapabilityApi
      tools: ToolRepository
      workspaces: WorkspaceRepository
      agents: AgentRepository
      ownerId: string
      toolId: (name: string) => Promise<string>
    }) => Promise<void>,
  ): Promise<void> => {
    const prefix = `a${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, storage.schema)
      const schema = storage.schema
      const tools = new ToolRepository(storage.pool, schema)
      const workspaces = new WorkspaceRepository(storage.pool, schema)
      const agents = new AgentRepository(storage.pool, schema)
      const api = createCapabilityApi({
        ownerId,
        tools,
        prompts: new PromptRepository(storage.pool, schema),
        skills: new SkillRepository(storage.pool, schema),
        servers: new WorkspaceMcpServerRepository(storage.pool, schema),
        links: new CapabilityLinks(storage.pool, schema),
        readWorkspace: async (id) => {
          const workspace = await workspaces.find(id)

          return workspace === undefined
            ? undefined
            : { allowAll: workspace.allowAll, archivedAt: workspace.archivedAt }
        },
        readAgent: async (id) => {
          const agent = await agents.find(id)

          return agent === undefined
            ? undefined
            : { workspaceId: agent.workspaceId, archivedAt: agent.archivedAt }
        },
        offeredTools: () => [{ name: 'bash' }, { name: 'read' }],
      })

      await use({
        api,
        tools,
        workspaces,
        agents,
        ownerId,
        toolId: async (name) => {
          const found = (await tools.list(ownerId)).find((tool) => tool.name === name)
          if (found === undefined) throw new Error(`no tool named ${name}`)

          return found.id
        },
      })
    } finally {
      await storage.close({} as never)
    }
  }

  describe('CapabilityApi', () => {
    it('fills the tool catalog from what the registry offers', async () => {
      await withApi(async ({ api }) => {
        const tools = await api.tools.sync()

        expect(tools.map((tool) => tool.name)).toEqual(['bash', 'read'])
      })
    })

    it('refuses an agent grant the workspace does not reach', async () => {
      await withApi(async ({ api, workspaces, agents, ownerId, toolId }) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        const agent = await agents.create(workspace.id, { name: 'Reviewer' })
        await api.tools.sync()
        const bash = await toolId('bash')
        const read = await toolId('read')

        await api.setWorkspaceGrants(workspace.id, {
          tools: [read],
          prompts: [],
          skills: [],
        })

        await expect(
          api.setAgentGrants(agent.id, { tools: [bash], prompts: [], skills: [], mcpServers: [] }),
        ).rejects.toMatchObject({ code: 'CAPABILITY_NOT_ALLOWED', statusCode: 400 })

        await expect(
          api.setAgentGrants(agent.id, { tools: [read], prompts: [], skills: [], mcpServers: [] }),
        ).resolves.toMatchObject({ tools: [read] })
      })
    })

    it('lets a workspace that allows everything grant without a list', async () => {
      await withApi(async ({ api, tools, workspaces, agents, ownerId }) => {
        const workspace = await workspaces.create(ownerId, { name: 'General', allowAll: true }, IMAGE)
        const agent = await agents.create(workspace.id, { name: 'Anything' })
        await api.tools.sync()
        const all = await tools.list(ownerId)

        await api.setWorkspaceGrants(workspace.id, {
          tools: [],
          prompts: [],
          skills: [],
        })

        await expect(
          api.setAgentGrants(agent.id, {
            tools: all.map((tool) => tool.id),
            prompts: [],
            skills: [],
            mcpServers: [],
          }),
        ).resolves.toMatchObject({ tools: all.map((tool) => tool.id) })
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
