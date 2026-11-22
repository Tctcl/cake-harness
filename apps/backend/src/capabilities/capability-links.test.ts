import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { AgentRepository } from '../agents/agent-repository.js'
import { WorkspaceRepository } from '../workspaces/workspace-repository.js'
import { CapabilityLinks } from './capability-links.js'
import { McpCredentialRepository, McpServerRepository } from './mcp-repository.js'
import { ToolRepository } from './tool-repository.js'

/** Live-server suite like its neighbours: `DATABASE_URL` names a disposable database, and every case gets a prefix. */
const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('CapabilityLinks (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  const withWorld = async (
    use: (world: {
      links: CapabilityLinks
      tools: ToolRepository
      workspaces: WorkspaceRepository
      agents: AgentRepository
      mcp: McpServerRepository
      credentials: McpCredentialRepository
      ownerId: string
    }) => Promise<void>,
  ): Promise<void> => {
    const prefix = `l${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, storage.schema)
      const schema = storage.schema
      await use({
        links: new CapabilityLinks(storage.pool, schema),
        tools: new ToolRepository(storage.pool, schema),
        workspaces: new WorkspaceRepository(storage.pool, schema),
        agents: new AgentRepository(storage.pool, schema),
        mcp: new McpServerRepository(storage.pool, schema),
        credentials: new McpCredentialRepository(storage.pool, schema),
        ownerId,
      })
    } finally {
      await storage.close({} as never)
    }
  }

  describe('CapabilityLinks', () => {
    it('syncs tools from what the registry offers and archives what it stops offering', async () => {
      await withWorld(async ({ tools, ownerId }) => {
        await tools.sync(ownerId, [
          { name: 'bash', description: 'Run a command', parameters: { type: 'object' } },
          { name: 'read' },
        ])

        const synced = await tools.list(ownerId)
        expect(synced.map((tool) => tool.name)).toEqual(['bash', 'read'])
        expect(synced[0]?.inputSchema).toEqual({ type: 'object' })

        await tools.sync(ownerId, [{ name: 'bash' }, { name: 'read' }])
        expect((await tools.list(ownerId)).map((tool) => tool.name)).toEqual(['bash', 'read'])

        await tools.sync(ownerId, [{ name: 'bash' }])
        expect((await tools.list(ownerId)).map((tool) => tool.name)).toEqual(['bash'])
        expect((await tools.list(ownerId, { archived: true })).map((tool) => tool.name)).toEqual(['read'])
      })
    })

    it('keeps one server with two credentials, and lets an agent pick the other one', async () => {
      await withWorld(async ({ links, tools, workspaces, agents, mcp, credentials, ownerId }) => {
        const tool = await tools.sync(ownerId, [{ name: 'bash' }]).then(async () => {
          const all = await tools.list(ownerId)
          return all[0]
        })
        const workspace = await workspaces.create(ownerId, { name: 'Platform' })
        const first = await agents.create(workspace.id, { name: 'first' })
        const second = await agents.create(workspace.id, { name: 'second' })

        const server = await mcp.create(ownerId, {
          name: 'github',
          transport: 'stdio',
          command: 'github-mcp',
          envSchema: { GITHUB_TOKEN: 'GITHUB_TOKEN' },
        })
        const mine = await credentials.create(ownerId, server.id, { label: 'mine', consumer: 'alice' })
        const theirs = await credentials.create(ownerId, server.id, { label: 'theirs', consumer: 'bob' })

        expect(tool).toBeDefined()

        await links.replaceWorkspace(workspace.id, {
          tools: tool === undefined ? [] : [tool.id],
          prompts: [],
          skills: [],
          mcpServers: [{ serverId: server.id, credentialId: mine.id }],
          credentials: [mine.id, theirs.id],
        })
        await links.replaceAgent(first.id, { tools: [], prompts: [], skills: [], mcpServers: [] })
        await links.replaceAgent(second.id, {
          tools: [],
          prompts: [],
          skills: [],
          mcpServers: [{ serverId: server.id, credentialId: theirs.id }],
        })

        const workspaceGrants = await links.readWorkspace(workspace.id)
        expect(workspaceGrants.credentials).toHaveLength(2)
        expect(workspaceGrants.mcpServers).toEqual([{ serverId: server.id, credentialId: mine.id }])

        // An agent that names no credential runs as the workspace's default for that server.
        expect((await links.readAgent(first.id)).mcpServers).toEqual([])
        expect((await links.readAgent(second.id)).mcpServers).toEqual([
          { serverId: server.id, credentialId: theirs.id },
        ])
      })
    })

    it('refuses a grant of a row that does not exist', async () => {
      await withWorld(async ({ links, workspaces, ownerId }) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' })

        await expect(
          links.replaceWorkspace(workspace.id, {
            tools: ['00000000-0000-4000-8000-0000000000ff'],
            prompts: [],
            skills: [],
            mcpServers: [],
            credentials: [],
          }),
        ).rejects.toThrow(/foreign key/i)
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
