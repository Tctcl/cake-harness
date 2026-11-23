import type { FastifyPluginAsync } from 'fastify'

import type { Agent } from '../agent.js'
import type { AgentPatch, AgentProfile } from '../agents/agent-repository.js'
import { AppError } from '../errors.js'
import type { Workspace, WorkspacePatch } from '../workspaces/workspace-repository.js'

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

const workspaceIdParams = {
  type: 'object',
  properties: { workspaceId: { type: 'string', pattern: uuid } },
  required: ['workspaceId'],
  additionalProperties: false,
} as const

const agentIdParams = {
  type: 'object',
  properties: { workspaceId: { type: 'string', pattern: uuid }, agentId: { type: 'string', pattern: uuid } },
  required: ['workspaceId', 'agentId'],
  additionalProperties: false,
} as const

// Archiving is a filter, not a second resource, so it rides on the list as a query flag: absent means live rows only.
const archivedQuery = {
  type: 'object',
  properties: { archived: { type: 'string', enum: ['true', 'false'] } },
  additionalProperties: false,
} as const

const workspaceProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  description: { type: 'string' },
  isDefault: { type: 'boolean' },
  allowAll: { type: 'boolean' },
  archivedAt: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
} as const

const workspaceSchema = {
  type: 'object',
  properties: workspaceProperties,
  required: [
    'id',
    'name',
    'description',
    'isDefault',
    'allowAll',
    'archivedAt',
    'createdAt',
    'updatedAt',
  ],
} as const

const workspaceListSchema = {
  type: 'object',
  properties: { workspaces: { type: 'array', items: workspaceSchema } },
  required: ['workspaces'],
} as const

const createWorkspaceBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    allowAll: { type: 'boolean' },
  },
  required: ['name'],
  additionalProperties: false,
} as const

const updateWorkspaceBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    allowAll: { type: 'boolean' },
  },
  additionalProperties: false,
} as const

const agentProperties = {
  id: { type: 'string' },
  workspaceId: { type: 'string' },
  name: { type: 'string' },
  description: { type: 'string' },
  isDefault: { type: 'boolean' },
  allowAll: { type: 'boolean' },
  systemPrompt: { type: 'string' },
  instructions: { type: 'string' },
  archivedAt: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
} as const

const agentSchema = {
  type: 'object',
  properties: agentProperties,
  required: [
    'id',
    'workspaceId',
    'name',
    'description',
    'isDefault',
    'allowAll',
    'systemPrompt',
    'instructions',
    'archivedAt',
    'createdAt',
    'updatedAt',
  ],
} as const

const agentListSchema = {
  type: 'object',
  properties: { agents: { type: 'array', items: agentSchema } },
  required: ['agents'],
} as const

const createAgentBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    allowAll: { type: 'boolean' },
    systemPrompt: { type: 'string' },
    instructions: { type: 'string' },
  },
  required: ['name'],
  additionalProperties: false,
} as const

const updateAgentBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    allowAll: { type: 'boolean' },
    systemPrompt: { type: 'string' },
    instructions: { type: 'string' },
  },
  additionalProperties: false,
} as const

interface WorkspaceIdParams {
  workspaceId: string
}

interface AgentIdParams {
  workspaceId: string
  agentId: string
}

interface ArchivedQuery {
  archived?: 'true' | 'false'
}

type CreateWorkspaceBody = {
  name: string
  description?: string
  allowAll?: boolean
}

type UpdateWorkspaceBody = WorkspacePatch

type CreateAgentBody = {
  name: string
  description?: string
  allowAll?: boolean
  systemPrompt?: string
  instructions?: string
}

type UpdateAgentBody = AgentPatch

const notFound = (message: string, code: string): AppError =>
  new AppError(message, { statusCode: 404, code })

const toWorkspace = (workspace: Workspace) => ({
  ...workspace,
  // `Date` serializes through `String()`, which is not the ISO form the response schema promises.
  archivedAt: workspace.archivedAt === null ? null : workspace.archivedAt.toISOString(),
  createdAt: workspace.createdAt.toISOString(),
  updatedAt: workspace.updatedAt.toISOString(),
})

const toAgent = (agent: AgentProfile) => ({
  ...agent,
  archivedAt: agent.archivedAt === null ? null : agent.archivedAt.toISOString(),
  createdAt: agent.createdAt.toISOString(),
  updatedAt: agent.updatedAt.toISOString(),
})

export const workspaceRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  server.get<{ Querystring: ArchivedQuery }>(
    '/workspaces',
    { schema: { querystring: archivedQuery, response: { 200: workspaceListSchema } } },
    async (request) => ({
      workspaces: (await options.agent.workspaces({ archived: request.query.archived === 'true' })).map(
        toWorkspace,
      ),
    }),
  )

  server.post<{ Body: CreateWorkspaceBody }>(
    '/workspaces',
    { schema: { body: createWorkspaceBody, response: { 201: workspaceSchema } } },
    async (request, reply) =>
      reply.code(201).send(toWorkspace(await options.agent.createWorkspace(request.body))),
  )

  server.get<{ Params: WorkspaceIdParams }>(
    '/workspaces/:workspaceId',
    { schema: { params: workspaceIdParams, response: { 200: workspaceSchema } } },
    async (request) => {
      const all = await options.agent.workspaces()
      const workspace = all.find((candidate) => candidate.id === request.params.workspaceId)
      if (workspace === undefined) {
        throw notFound('the workspace does not exist', 'WORKSPACE_NOT_FOUND')
      }

      return toWorkspace(workspace)
    },
  )

  server.patch<{ Params: WorkspaceIdParams; Body: UpdateWorkspaceBody }>(
    '/workspaces/:workspaceId',
    { schema: { params: workspaceIdParams, body: updateWorkspaceBody, response: { 200: workspaceSchema } } },
    async (request) => {
      const workspace = await options.agent.updateWorkspace(request.params.workspaceId, request.body)
      if (workspace === undefined) {
        throw notFound('the workspace does not exist', 'WORKSPACE_NOT_FOUND')
      }

      return toWorkspace(workspace)
    },
  )

  server.post<{ Params: WorkspaceIdParams }>(
    '/workspaces/:workspaceId/archive',
    { schema: { params: workspaceIdParams, response: { 200: workspaceSchema } } },
    async (request) => {
      const workspace = await options.agent.archiveWorkspace(request.params.workspaceId)
      if (workspace === undefined) {
        throw notFound('the workspace does not exist', 'WORKSPACE_NOT_FOUND')
      }

      return toWorkspace(workspace)
    },
  )

  server.post<{ Params: WorkspaceIdParams }>(
    '/workspaces/:workspaceId/restore',
    { schema: { params: workspaceIdParams, response: { 200: workspaceSchema } } },
    async (request) => {
      const workspace = await options.agent.restoreWorkspace(request.params.workspaceId)
      if (workspace === undefined) {
        throw notFound('the workspace does not exist', 'WORKSPACE_NOT_FOUND')
      }

      return toWorkspace(workspace)
    },
  )

  server.delete<{ Params: WorkspaceIdParams }>(
    '/workspaces/:workspaceId',
    { schema: { params: workspaceIdParams } },
    async (request, reply) => {
      const removed = await options.agent.deleteWorkspace(request.params.workspaceId)
      if (!removed) throw notFound('the workspace does not exist', 'WORKSPACE_NOT_FOUND')

      return reply.code(204).send()
    },
  )

  server.get<{ Params: WorkspaceIdParams; Querystring: ArchivedQuery }>(
    '/workspaces/:workspaceId/agents',
    { schema: { params: workspaceIdParams, querystring: archivedQuery, response: { 200: agentListSchema } } },
    async (request) => {
      const agents = await options.agent.agents(request.params.workspaceId, {
        archived: request.query.archived === 'true',
      })

      return { agents: agents.map(toAgent) }
    },
  )

  server.post<{ Params: WorkspaceIdParams; Body: CreateAgentBody }>(
    '/workspaces/:workspaceId/agents',
    { schema: { params: workspaceIdParams, body: createAgentBody, response: { 201: agentSchema } } },
    async (request, reply) => {
      const created = await options.agent.createAgent(request.params.workspaceId, request.body)

      return reply.code(201).send(toAgent(created))
    },
  )

  server.patch<{ Params: AgentIdParams; Body: UpdateAgentBody }>(
    '/workspaces/:workspaceId/agents/:agentId',
    { schema: { params: agentIdParams, body: updateAgentBody, response: { 200: agentSchema } } },
    async (request) => {
      const agent = await options.agent.updateAgent(request.params.agentId, request.body)
      if (agent === undefined) throw notFound('the agent does not exist', 'AGENT_NOT_FOUND')

      return toAgent(agent)
    },
  )

  server.post<{ Params: AgentIdParams }>(
    '/workspaces/:workspaceId/agents/:agentId/archive',
    { schema: { params: agentIdParams, response: { 200: agentSchema } } },
    async (request) => {
      const agent = await options.agent.archiveAgent(request.params.agentId)
      if (agent === undefined) throw notFound('the agent does not exist', 'AGENT_NOT_FOUND')

      return toAgent(agent)
    },
  )

  server.post<{ Params: AgentIdParams }>(
    '/workspaces/:workspaceId/agents/:agentId/restore',
    { schema: { params: agentIdParams, response: { 200: agentSchema } } },
    async (request) => {
      const agent = await options.agent.restoreAgent(request.params.agentId)
      if (agent === undefined) throw notFound('the agent does not exist', 'AGENT_NOT_FOUND')

      return toAgent(agent)
    },
  )

  server.delete<{ Params: AgentIdParams }>(
    '/workspaces/:workspaceId/agents/:agentId',
    { schema: { params: agentIdParams } },
    async (request, reply) => {
      const removed = await options.agent.deleteAgent(request.params.agentId)
      if (!removed) throw notFound('the agent does not exist', 'AGENT_NOT_FOUND')

      return reply.code(204).send()
    },
  )
}
