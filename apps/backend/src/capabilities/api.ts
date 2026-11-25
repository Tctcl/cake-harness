import { AppError } from '../errors.js'
import { assertWithinCeiling } from '../agents/capabilities.js'
import type { AgentGrants, CapabilityLinks, WorkspaceGrants } from './capability-links.js'
import type {
  WorkspaceMcpServer,
  WorkspaceMcpServerInput,
  WorkspaceMcpServerPatch,
  WorkspaceMcpServerRepository,
} from './mcp-repository.js'
import type { PromptRepository, SkillRepository, TextEntry, TextInput, TextPatch } from './text-repository.js'
import type { Tool, ToolOffer, ToolRepository } from './tool-repository.js'

/** A workspace's ceiling as the API reports it: the grants plus the flag that makes the grants moot. */
export interface WorkspaceGrantSet {
  readonly allowAll: boolean
  readonly grants: WorkspaceGrants
}

/** One catalog of named text entries, so prompts and skills share a single set of routes. */
export interface TextCatalog {
  list(query?: { archived?: boolean | undefined }): Promise<TextEntry[]>
  find(id: string): Promise<TextEntry | undefined>
  create(input: TextInput): Promise<TextEntry>
  update(id: string, patch: TextPatch): Promise<TextEntry>
  archive(id: string): Promise<TextEntry>
  restore(id: string): Promise<TextEntry>
  remove(id: string): Promise<void>
}

/**
 * Everything the capability surface needs, in one object the routes can reach through the agent.
 *
 * The catalogs are workspace-independent: a tool, prompt, skill, MCP server or credential exists once per owner, and a
 * workspace only decides which of them are reachable. That is why the links live here rather than on the catalog rows.
 */
export interface CapabilityApi {
  readonly tools: {
    list(query?: { archived?: boolean | undefined }): Promise<Tool[]>
    /** Re-read the registry the harness runs with, so the catalog matches the tools a session can actually call. */
    sync(): Promise<Tool[]>
  }
  readonly prompts: TextCatalog
  readonly skills: TextCatalog
  readonly servers: {
    list(workspaceId: string, query?: { archived?: boolean | undefined }): Promise<WorkspaceMcpServer[]>
    find(workspaceId: string, id: string): Promise<WorkspaceMcpServer | undefined>
    create(workspaceId: string, input: WorkspaceMcpServerInput): Promise<WorkspaceMcpServer>
    update(workspaceId: string, id: string, patch: WorkspaceMcpServerPatch): Promise<WorkspaceMcpServer>
    archive(workspaceId: string, id: string): Promise<WorkspaceMcpServer>
    restore(workspaceId: string, id: string): Promise<WorkspaceMcpServer>
    remove(workspaceId: string, id: string): Promise<void>
  }
  workspaceGrants(workspaceId: string): Promise<WorkspaceGrantSet>
  setWorkspaceGrants(workspaceId: string, grants: WorkspaceGrants): Promise<WorkspaceGrantSet>
  agentGrants(agentId: string): Promise<AgentGrants>
  setAgentGrants(agentId: string, grants: AgentGrants): Promise<AgentGrants>
}

export interface CapabilityApiOptions {
  readonly ownerId: string
  readonly tools: ToolRepository
  readonly prompts: PromptRepository
  readonly skills: SkillRepository
  readonly servers: WorkspaceMcpServerRepository
  readonly links: CapabilityLinks
  readonly readWorkspace: (id: string) => Promise<{ readonly allowAll: boolean; readonly archivedAt: Date | null } | undefined>
  readonly readAgent: (id: string) => Promise<{ readonly workspaceId: string; readonly archivedAt: Date | null } | undefined>
  /** The tools the harness registry currently holds. */
  readonly offeredTools: () => readonly ToolOffer[]
}

const unknown = (what: string): AppError =>
  new AppError(`the ${what} does not exist`, { statusCode: 404, code: `${what.toUpperCase()}_NOT_FOUND` })

const archivedScope = (query: { archived?: boolean | undefined } | undefined) => ({
  archived: query?.archived,
})

const textCatalog = (
  repository: PromptRepository | SkillRepository,
  ownerId: string,
): TextCatalog => ({
  list: (query) => repository.list(ownerId, archivedScope(query)),
  find: (id) => repository.find(id),
  create: (input) => repository.create(ownerId, input),
  update: (id, patch) => repository.update(id, patch),
  archive: (id) => repository.archive(id),
  restore: (id) => repository.restore(id),
  remove: (id) => repository.delete(id),
})

/**
 * Binds the repositories to one owner and one harness registry. Every method here answers a route: nothing caches, so a
 * catalog edit is visible to the next request rather than to the next restart.
 */
export const createCapabilityApi = (options: CapabilityApiOptions): CapabilityApi => {
  const { ownerId, links } = options

  const workspaceGrants = async (workspaceId: string): Promise<WorkspaceGrantSet> => {
    const workspace = await options.readWorkspace(workspaceId)
    if (workspace === undefined) throw unknown('workspace')

    return { allowAll: workspace.allowAll, grants: await links.readWorkspace(workspaceId) }
  }

  const agentGrants = async (agentId: string): Promise<AgentGrants> => {
    if ((await options.readAgent(agentId)) === undefined) throw unknown('agent')

    return links.readAgent(agentId)
  }

  return {
    tools: {
      list: (query) => options.tools.list(ownerId, archivedScope(query)),
      async sync() {
        await options.tools.sync(ownerId, options.offeredTools())

        return options.tools.list(ownerId)
      },
    },
    prompts: textCatalog(options.prompts, ownerId),
    skills: textCatalog(options.skills, ownerId),
    servers: {
      list: (workspaceId, query) => options.servers.list(workspaceId, archivedScope(query)),
      find: (workspaceId, id) => options.servers.find(workspaceId, id),
      create: (workspaceId, input) => options.servers.create(workspaceId, input),
      update: (workspaceId, id, patch) => options.servers.update(workspaceId, id, patch),
      archive: (workspaceId, id) => options.servers.archive(workspaceId, id),
      restore: (workspaceId, id) => options.servers.restore(workspaceId, id),
      remove: (workspaceId, id) => options.servers.delete(workspaceId, id),
    },
    workspaceGrants,

    async setWorkspaceGrants(workspaceId, grants) {
      const workspace = await options.readWorkspace(workspaceId)
      if (workspace === undefined) throw unknown('workspace')

      await links.replaceWorkspace(workspaceId, grants)

      return workspaceGrants(workspaceId)
    },

    agentGrants,

    async setAgentGrants(agentId, grants) {
      const agent = await options.readAgent(agentId)
      if (agent === undefined) throw unknown('agent')
      const workspace = await options.readWorkspace(agent.workspaceId)
      if (workspace === undefined) throw unknown('workspace')

      // An agent may only reach what its workspace reaches, so the ceiling is checked against the merged result rather
      // than against whatever the caller happened to send. The servers are the workspace's own rows, not a grant.
      assertWithinCeiling(
        {
          allowAll: workspace.allowAll,
          ...(await links.readWorkspace(agent.workspaceId)),
          mcpServers: (await options.servers.list(agent.workspaceId)).map((server) => server.id),
        },
        grants,
      )

      await links.replaceAgent(agentId, grants)

      return agentGrants(agentId)
    },
  }
}
