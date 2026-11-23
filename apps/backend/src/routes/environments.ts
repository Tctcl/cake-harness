import type { FastifyPluginAsync } from 'fastify'

import type { Agent } from '../agent.js'
import type { EnvironmentApi } from '../environments/api.js'
import type { DevEnvironment, EnvironmentPatch } from '../environments/environment-repository.js'
import { AppError } from '../errors.js'

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

const environmentIdParams = {
  type: 'object',
  properties: { environmentId: { type: 'string', pattern: uuid } },
  required: ['environmentId'],
  additionalProperties: false,
} as const

const workspaceIdParams = {
  type: 'object',
  properties: { workspaceId: { type: 'string', pattern: uuid } },
  required: ['workspaceId'],
  additionalProperties: false,
} as const

const workspaceEnvironmentParams = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string', pattern: uuid },
    environmentId: { type: 'string', pattern: uuid },
  },
  required: ['workspaceId', 'environmentId'],
  additionalProperties: false,
} as const

const workspaceAgentParams = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string', pattern: uuid },
    agentId: { type: 'string', pattern: uuid },
  },
  required: ['workspaceId', 'agentId'],
  additionalProperties: false,
} as const

const environmentProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  image: { type: 'string' },
  containerId: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
} as const

const environmentSchema = {
  type: 'object',
  properties: environmentProperties,
  required: ['id', 'name', 'image', 'containerId', 'createdAt', 'updatedAt'],
} as const

const environmentListSchema = {
  type: 'object',
  properties: { environments: { type: 'array', items: environmentSchema } },
  required: ['environments'],
} as const

// The link tables answer ids, so the wrapper says which table it came from rather than posing as the rows.
const workspaceIdsSchema = {
  type: 'object',
  properties: { workspaceIds: { type: 'array', items: { type: 'string' } } },
  required: ['workspaceIds'],
} as const

// An agent works in at most one environment: `null` is the state, not a missing answer.
const agentEnvironmentSchema = {
  type: 'object',
  properties: { environment: { ...environmentSchema, type: ['object', 'null'] } },
  required: ['environment'],
} as const

const createEnvironmentBody = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1 } },
  required: ['name'],
  additionalProperties: false,
} as const

// `image` is a tag the platform publishes; a patch either names one or leaves it alone, and `null` is refused because
// an environment without an image has nothing to start.
const updateEnvironmentBody = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1 }, image: { type: 'string', minLength: 1 } },
  additionalProperties: false,
} as const

const attachBody = {
  type: 'object',
  properties: { environmentId: { type: 'string', pattern: uuid } },
  required: ['environmentId'],
  additionalProperties: false,
} as const

const connectBody = {
  type: 'object',
  properties: { environmentId: { type: 'string', pattern: uuid } },
  required: ['environmentId'],
  additionalProperties: false,
} as const

interface EnvironmentIdParams {
  environmentId: string
}

interface WorkspaceIdParams {
  workspaceId: string
}

interface WorkspaceEnvironmentParams {
  workspaceId: string
  environmentId: string
}

interface WorkspaceAgentParams {
  workspaceId: string
  agentId: string
}

const notFound = (message: string, code: string): AppError =>
  new AppError(message, { statusCode: 404, code })

const missing = (): AppError =>
  notFound('the environment does not exist', 'ENVIRONMENT_NOT_FOUND')

const toEnvironment = (environment: DevEnvironment) => ({
  ...environment,
  // `Date` serializes through `String()`, which is not the ISO form the response schema promises.
  createdAt: environment.createdAt.toISOString(),
  updatedAt: environment.updatedAt.toISOString(),
})

export const environmentRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  const environments: EnvironmentApi = options.agent.environments

  // The workspace is the scope the client is looking through, so an unknown one is a 404 before the link table is
  // consulted — otherwise an empty list would hide a typo in the id.
  const requireWorkspace = async (workspaceId: string): Promise<void> => {
    const workspace = await options.agent.workspace(workspaceId)
    if (workspace === undefined) {
      throw notFound('the workspace does not exist', 'WORKSPACE_NOT_FOUND')
    }
  }

  // Checked here rather than left to the foreign key: an unknown agent is a 404, not a constraint violation that
  // surfaces as a 500.
  const requireAgent = async (workspaceId: string, agentId: string): Promise<void> => {
    await requireWorkspace(workspaceId)
    const agents = await options.agent.agents(workspaceId)
    if (!agents.some((candidate) => candidate.id === agentId)) {
      throw notFound('the agent does not exist', 'AGENT_NOT_FOUND')
    }
  }

  server.get(
    '/environments',
    { schema: { response: { 200: environmentListSchema } } },
    async () => ({ environments: (await environments.list()).map(toEnvironment) }),
  )

  server.post<{ Body: { name: string } }>(
    '/environments',
    { schema: { body: createEnvironmentBody, response: { 201: environmentSchema } } },
    async (request, reply) =>
      reply.code(201).send(toEnvironment(await environments.create(request.body.name))),
  )

  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId',
    { schema: { params: environmentIdParams, response: { 200: environmentSchema } } },
    async (request) => {
      const environment = await environments.find(request.params.environmentId)
      if (environment === undefined) throw missing()

      return toEnvironment(environment)
    },
  )

  server.patch<{ Params: EnvironmentIdParams; Body: EnvironmentPatch }>(
    '/environments/:environmentId',
    {
      schema: {
        params: environmentIdParams,
        body: updateEnvironmentBody,
        response: { 200: environmentSchema },
      },
    },
    async (request) => {
      const updated = await environments.update(request.params.environmentId, request.body)
      if (updated === undefined) throw missing()

      return toEnvironment(updated)
    },
  )

  server.delete<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId',
    { schema: { params: environmentIdParams } },
    async (request, reply) => {
      // The container is removed before the row, so a failure here leaves a state the next attempt can see.
      const removed = await environments.remove(request.params.environmentId)
      if (!removed) throw missing()

      return reply.code(204).send()
    },
  )

  server.post<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/start',
    { schema: { params: environmentIdParams, response: { 200: environmentSchema } } },
    async (request) => {
      const started = await environments.start(request.params.environmentId)
      if (started === undefined) throw missing()

      return toEnvironment(started)
    },
  )

  server.post<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/stop',
    { schema: { params: environmentIdParams, response: { 200: environmentSchema } } },
    async (request) => {
      const stopped = await environments.stop(request.params.environmentId)
      if (stopped === undefined) throw missing()

      return toEnvironment(stopped)
    },
  )

  server.get<{ Params: EnvironmentIdParams }>(
    '/environments/:environmentId/workspaces',
    { schema: { params: environmentIdParams, response: { 200: workspaceIdsSchema } } },
    async (request) => ({
      workspaceIds: await environments.workspacesOf(request.params.environmentId),
    }),
  )

  server.get<{ Params: WorkspaceIdParams }>(
    '/workspaces/:workspaceId/environments',
    { schema: { params: workspaceIdParams, response: { 200: environmentListSchema } } },
    async (request) => {
      await requireWorkspace(request.params.workspaceId)

      return {
        environments: (await environments.ofWorkspace(request.params.workspaceId)).map(toEnvironment),
      }
    },
  )

  server.post<{ Params: WorkspaceIdParams; Body: { environmentId: string } }>(
    '/workspaces/:workspaceId/environments',
    { schema: { params: workspaceIdParams, body: attachBody } },
    async (request, reply) => {
      await requireWorkspace(request.params.workspaceId)
      if ((await environments.find(request.body.environmentId)) === undefined) throw missing()

      // Attaching what is already attached is the state the caller asked for, so it is not an error.
      await environments.attach(request.params.workspaceId, request.body.environmentId)

      return reply.code(204).send()
    },
  )

  server.delete<{ Params: WorkspaceEnvironmentParams }>(
    '/workspaces/:workspaceId/environments/:environmentId',
    { schema: { params: workspaceEnvironmentParams } },
    async (request, reply) => {
      const detached = await environments.detach(request.params.workspaceId, request.params.environmentId)
      if (!detached) throw notFound('the workspace does not offer that environment', 'ENVIRONMENT_NOT_ATTACHED')

      return reply.code(204).send()
    },
  )

  server.get<{ Params: WorkspaceAgentParams }>(
    '/workspaces/:workspaceId/agents/:agentId/environment',
    { schema: { params: workspaceAgentParams, response: { 200: agentEnvironmentSchema } } },
    async (request) => {
      await requireAgent(request.params.workspaceId, request.params.agentId)
      const environment = await environments.ofAgent(request.params.agentId)

      return { environment: environment === undefined ? null : toEnvironment(environment) }
    },
  )

  server.put<{ Params: WorkspaceAgentParams; Body: { environmentId: string } }>(
    '/workspaces/:workspaceId/agents/:agentId/environment',
    {
      schema: {
        params: workspaceAgentParams,
        body: connectBody,
        response: { 200: agentEnvironmentSchema },
      },
    },
    async (request) => {
      await requireAgent(request.params.workspaceId, request.params.agentId)
      const environment = await environments.find(request.body.environmentId)
      if (environment === undefined) throw missing()

      await environments.connectAgent(request.params.agentId, request.body.environmentId)

      return { environment: toEnvironment(environment) }
    },
  )

  server.delete<{ Params: WorkspaceAgentParams }>(
    '/workspaces/:workspaceId/agents/:agentId/environment',
    { schema: { params: workspaceAgentParams } },
    async (request, reply) => {
      await requireAgent(request.params.workspaceId, request.params.agentId)
      const disconnected = await environments.disconnectAgent(request.params.agentId)
      if (!disconnected) throw notFound('the agent has no environment', 'ENVIRONMENT_NOT_ATTACHED')

      return reply.code(204).send()
    },
  )
}
