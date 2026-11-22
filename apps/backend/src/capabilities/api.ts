import { AppError } from '../errors.js'
import { assertWithinCeiling } from '../agents/capabilities.js'
import type { AgentGrants, CapabilityLinks, WorkspaceGrants } from './capability-links.js'
import type {
  McpCredential,
  McpCredentialInput,
  McpCredentialPatch,
  McpServer,
  McpServerInput,
  McpServerPatch,
} from './mcp-repository.js'
import type { McpCredentialRepository, McpServerRepository } from './mcp-repository.js'
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
    list(query?: { archived?: boolean | undefined }): Promise<McpServer[]>
    find(id: string): Promise<McpServer | undefined>
    create(input: McpServerInput): Promise<McpServer>
    update(id: string, patch: McpServerPatch): Promise<McpServer>
    archive(id: string): Promise<McpServer>
    restore(id: string): Promise<McpServer>
    remove(id: string): Promise<void>
  }
  readonly credentials: {
    list(serverId: string, query?: { archived?: boolean | undefined }): Promise<McpCredential[]>
    create(serverId: string, input: McpCredentialInput): Promise<McpCredential>
    update(id: string, patch: McpCredentialPatch): Promise<McpCredential>
    archive(id: string): Promise<McpCredential>
    restore(id: string): Promise<McpCredential>
    remove(id: string): Promise<void>
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
  readonly servers: McpServerRepository
  readonly credentials: McpCredentialRepository
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
      list: (query) => options.servers.list(ownerId, archivedScope(query)),
      find: (id) => options.servers.find(id),
      create: (input) => options.servers.create(ownerId, input),
      update: (id, patch) => options.servers.update(id, patch),
      archive: (id) => options.servers.archive(id),
      restore: (id) => options.servers.restore(id),
      remove: (id) => options.servers.delete(id),
    },
    credentials: {
      list: (serverId, query) => options.credentials.list(serverId, archivedScope(query)),
      create: (serverId, input) => options.credentials.create(ownerId, serverId, input),
      update: (id, patch) => options.credentials.update(id, patch),
      archive: (id) => options.credentials.archive(id),
      restore: (id) => options.credentials.restore(id),
      remove: (id) => options.credentials.delete(id),
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
      // than against whatever the caller happened to send.
      assertWithinCeiling(
        { allowAll: workspace.allowAll, ...(await links.readWorkspace(agent.workspaceId)) },
        grants,
      )

      await links.replaceAgent(agentId, grants)

      return agentGrants(agentId)
    },
  }
}
