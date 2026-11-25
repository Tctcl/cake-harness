import type { FastifyPluginAsync } from 'fastify'

import type { Agent } from '../agent.js'
import type { WorkspaceGrants, AgentGrants } from '../capabilities/capability-links.js'
import type {
  WorkspaceMcpServerInput,
  WorkspaceMcpServerPatch,
} from '../capabilities/mcp-repository.js'
import type { TextInput, TextPatch } from '../capabilities/text-repository.js'
import { AppError } from '../errors.js'

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

const idParams = (name: string) =>
  ({
    type: 'object',
    properties: { [name]: { type: 'string', pattern: uuid } },
    required: [name],
    additionalProperties: false,
  }) as const

const textIdParams = idParams('id')
const workspaceIdParams = idParams('workspaceId')
const agentIdParams = idParams('agentId')

/** A server is named by its workspace and its own id: the workspace is part of the identity, not a filter. */
const workspaceServerParams = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string', pattern: uuid },
    id: { type: 'string', pattern: uuid },
  },
  required: ['workspaceId', 'id'],
  additionalProperties: false,
} as const

const archivedQuery = {
  type: 'object',
  properties: { archived: { type: 'string', enum: ['true', 'false'] } },
  additionalProperties: false,
} as const

const stringList = { type: 'array', items: { type: 'string', pattern: uuid } } as const

const timestamps = {
  archivedAt: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
} as const

const textEntrySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    body: { type: 'string' },
    ...timestamps,
  },
  required: ['id', 'name', 'description', 'body', 'archivedAt', 'createdAt', 'updatedAt'],
} as const

const textInputBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['name'],
  additionalProperties: false,
} as const

const textPatchBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    body: { type: 'string' },
  },
  additionalProperties: false,
} as const

const toolSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    source: { type: 'string' },
    inputSchema: {},
    ...timestamps,
  },
  required: ['id', 'name', 'description', 'source', 'inputSchema', 'archivedAt', 'createdAt', 'updatedAt'],
} as const

const serverSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    workspaceId: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    transport: { type: 'string', enum: ['stdio', 'http'] },
    command: { type: ['string', 'null'] },
    args: { type: 'array', items: { type: 'string' } },
    cwd: { type: ['string', 'null'] },
    url: { type: ['string', 'null'] },
    env: { type: 'object', additionalProperties: { type: 'string' } },
    mcpId: { type: ['string', 'null'] },
    credentialId: { type: ['string', 'null'] },
    ...timestamps,
  },
  required: [
    'id',
    'workspaceId',
    'name',
    'description',
    'transport',
    'command',
    'args',
    'cwd',
    'url',
    'env',
    'mcpId',
    'credentialId',
    'archivedAt',
    'createdAt',
    'updatedAt',
  ],
} as const

// The transport decides which of `command`/`url` is meaningful, so the schema allows either and the database refuses
// the pair that contradicts it — duplicating that check here would be a second place to keep in step.
const serverInputBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    transport: { type: 'string', enum: ['stdio', 'http'] },
    command: { type: 'string', minLength: 1 },
    args: { type: 'array', items: { type: 'string' } },
    cwd: { type: 'string', minLength: 1 },
    url: { type: 'string', minLength: 1 },
    env: { type: 'object', additionalProperties: { type: 'string' } },
    mcpId: { type: 'string', minLength: 1 },
    credentialId: { type: ['string', 'null'] },
  },
  required: ['name', 'transport'],
  additionalProperties: false,
} as const

const serverPatchBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    transport: { type: 'string', enum: ['stdio', 'http'] },
    command: { type: ['string', 'null'] },
    args: { type: 'array', items: { type: 'string' } },
    cwd: { type: ['string', 'null'] },
    url: { type: ['string', 'null'] },
    env: { type: 'object', additionalProperties: { type: 'string' } },
    mcpId: { type: ['string', 'null'] },
    credentialId: { type: ['string', 'null'] },
  },
  additionalProperties: false,
} as const

const agentGrantsBody = {
  type: 'object',
  properties: {
    tools: stringList,
    skills: stringList,
    // Ids of the workspace's own servers: an agent selects from what the workspace created, it does not define one.
    mcpServers: stringList,
  },
  required: ['tools', 'skills', 'mcpServers'],
  additionalProperties: false,
} as const

// A workspace owns its MCP servers and each agent selects its own tools, so only skills remain a workspace grant.
const workspaceGrantsBody = {
  type: 'object',
  properties: { skills: stringList },
  required: ['skills'],
  additionalProperties: false,
} as const

const agentGrantsSchema = {
  type: 'object',
  properties: agentGrantsBody.properties,
  required: agentGrantsBody.required,
} as const

const workspaceGrantsSchema = {
  type: 'object',
  properties: {
    allowAll: { type: 'boolean' },
    grants: workspaceGrantsBody,
  },
  required: ['allowAll', 'grants'],
} as const

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString())

const toTextEntry = <T extends { archivedAt: Date | null; createdAt: Date; updatedAt: Date }>(entry: T) => ({
  ...entry,
  archivedAt: iso(entry.archivedAt),
  createdAt: entry.createdAt.toISOString(),
  updatedAt: entry.updatedAt.toISOString(),
})

const textRoutes = (
  server: Parameters<FastifyPluginAsync>[0],
  path: 'skills',
  capabilities: Agent['capabilities'],
): void => {
  const catalog = capabilities[path]
  const itemPath = `/${path}/:id`

  server.get<{ Querystring: { archived?: 'true' | 'false' } }>(
    `/${path}`,
    {
      schema: {
        querystring: archivedQuery,
        response: { 200: { type: 'object', properties: { entries: { type: 'array', items: textEntrySchema } } } },
      },
    },
    async (request) => ({
      entries: (await catalog.list({ archived: request.query.archived === 'true' })).map(toTextEntry),
    }),
  )

  server.post<{ Body: TextInput }>(
    `/${path}`,
    { schema: { body: textInputBody, response: { 201: textEntrySchema } } },
    async (request, reply) => reply.code(201).send(toTextEntry(await catalog.create(request.body))),
  )

  server.get<{ Params: { id: string } }>(
    itemPath,
    { schema: { params: textIdParams, response: { 200: textEntrySchema } } },
    async (request) => {
      const entry = await catalog.find(request.params.id)
      if (entry === undefined) throw notFound('ENTRY_NOT_FOUND')

      return toTextEntry(entry)
    },
  )

  server.patch<{ Params: { id: string }; Body: TextPatch }>(
    itemPath,
    { schema: { params: textIdParams, body: textPatchBody, response: { 200: textEntrySchema } } },
    async (request) => toTextEntry(await catalog.update(request.params.id, request.body)),
  )

  server.post<{ Params: { id: string } }>(
    `${itemPath}/archive`,
    { schema: { params: textIdParams, response: { 200: textEntrySchema } } },
    async (request) => toTextEntry(await catalog.archive(request.params.id)),
  )

  server.post<{ Params: { id: string } }>(
    `${itemPath}/restore`,
    { schema: { params: textIdParams, response: { 200: textEntrySchema } } },
    async (request) => toTextEntry(await catalog.restore(request.params.id)),
  )

  server.delete<{ Params: { id: string } }>(
    itemPath,
    { schema: { params: textIdParams } },
    async (request, reply) => {
      await catalog.remove(request.params.id)

      return reply.code(204).send()
    },
  )
}

export const capabilityRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  const { capabilities } = options.agent

  server.get<{ Querystring: { archived?: 'true' | 'false' } }>(
    '/tools',
    {
      schema: {
        querystring: archivedQuery,
        response: { 200: { type: 'object', properties: { tools: { type: 'array', items: toolSchema } } } },
      },
    },
    async (request) => ({
      tools: (await capabilities.tools.list({ archived: request.query.archived === 'true' })).map(toTextEntry),
    }),
  )

  textRoutes(server, 'skills', capabilities)

  server.get<{ Params: { workspaceId: string }; Querystring: { archived?: 'true' | 'false' } }>(
    '/workspaces/:workspaceId/mcp/servers',
    {
      schema: {
        params: workspaceIdParams,
        querystring: archivedQuery,
        response: { 200: { type: 'object', properties: { servers: { type: 'array', items: serverSchema } } } },
      },
    },
    async (request) => ({
      servers: (
        await capabilities.servers.list(request.params.workspaceId, {
          archived: request.query.archived === 'true',
        })
      ).map(toTextEntry),
    }),
  )

  server.post<{ Params: { workspaceId: string }; Body: WorkspaceMcpServerInput }>(
    '/workspaces/:workspaceId/mcp/servers',
    { schema: { params: workspaceIdParams, body: serverInputBody, response: { 201: serverSchema } } },
    async (request, reply) =>
      reply
        .code(201)
        .send(toTextEntry(await capabilities.servers.create(request.params.workspaceId, request.body))),
  )

  server.patch<{ Params: { workspaceId: string; id: string }; Body: WorkspaceMcpServerPatch }>(
    '/workspaces/:workspaceId/mcp/servers/:id',
    { schema: { params: workspaceServerParams, body: serverPatchBody, response: { 200: serverSchema } } },
    async (request) =>
      toTextEntry(
        await capabilities.servers.update(request.params.workspaceId, request.params.id, request.body),
      ),
  )

  server.post<{ Params: { workspaceId: string; id: string } }>(
    '/workspaces/:workspaceId/mcp/servers/:id/archive',
    { schema: { params: workspaceServerParams, response: { 200: serverSchema } } },
    async (request) =>
      toTextEntry(await capabilities.servers.archive(request.params.workspaceId, request.params.id)),
  )

  server.post<{ Params: { workspaceId: string; id: string } }>(
    '/workspaces/:workspaceId/mcp/servers/:id/restore',
    { schema: { params: workspaceServerParams, response: { 200: serverSchema } } },
    async (request) =>
      toTextEntry(await capabilities.servers.restore(request.params.workspaceId, request.params.id)),
  )

  server.delete<{ Params: { workspaceId: string; id: string } }>(
    '/workspaces/:workspaceId/mcp/servers/:id',
    { schema: { params: workspaceServerParams } },
    async (request, reply) => {
      await capabilities.servers.remove(request.params.workspaceId, request.params.id)

      return reply.code(204).send()
    },
  )

  server.get<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/grants',
    { schema: { params: workspaceIdParams, response: { 200: workspaceGrantsSchema } } },
    async (request) => capabilities.workspaceGrants(request.params.workspaceId),
  )

  server.put<{ Params: { workspaceId: string }; Body: WorkspaceGrants }>(
    '/workspaces/:workspaceId/grants',
    { schema: { params: workspaceIdParams, body: workspaceGrantsBody, response: { 200: workspaceGrantsSchema } } },
    async (request) => capabilities.setWorkspaceGrants(request.params.workspaceId, request.body),
  )

  server.get<{ Params: { agentId: string } }>(
    '/agents/:agentId/grants',
    { schema: { params: agentIdParams, response: { 200: agentGrantsSchema } } },
    async (request) => capabilities.agentGrants(request.params.agentId),
  )

  server.put<{ Params: { agentId: string }; Body: AgentGrants }>(
    '/agents/:agentId/grants',
    { schema: { params: agentIdParams, body: agentGrantsBody, response: { 200: agentGrantsSchema } } },
    async (request) => capabilities.setAgentGrants(request.params.agentId, request.body),
  )
}

const notFound = (code: string) => new AppError('the entry does not exist', { statusCode: 404, code })
