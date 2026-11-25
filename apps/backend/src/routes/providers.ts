import type { FastifyPluginAsync } from 'fastify'

import type { Agent } from '../agent.js'
import type { WorkspaceProviders } from '../providers/provider-repository.js'

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

const workspaceIdParams = {
  type: 'object',
  properties: { workspaceId: { type: 'string', pattern: uuid } },
  required: ['workspaceId'],
  additionalProperties: false,
} as const

const loginSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    provider: { type: 'string' },
    label: { type: 'string' },
    createdAt: { type: 'string' },
  },
  required: ['id', 'provider', 'label', 'createdAt'],
} as const

const loginListSchema = {
  type: 'object',
  properties: { logins: { type: 'array', items: loginSchema } },
  required: ['logins'],
} as const

const modelSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    provider: { type: 'string' },
    name: { type: 'string' },
    contextWindow: { type: ['integer', 'null'] },
    maxOutput: { type: ['integer', 'null'] },
    inputUsdPerMillion: { type: ['number', 'null'] },
    outputUsdPerMillion: { type: ['number', 'null'] },
    supportsReasoning: { type: 'boolean' },
    supportsTools: { type: 'boolean' },
  },
  required: [
    'id',
    'provider',
    'name',
    'contextWindow',
    'maxOutput',
    'inputUsdPerMillion',
    'outputUsdPerMillion',
    'supportsReasoning',
    'supportsTools',
  ],
} as const

const modelListSchema = {
  type: 'object',
  properties: { models: { type: 'array', items: modelSchema } },
  required: ['models'],
} as const

const workspaceProvidersProperties = {
  loginIds: { type: 'array', items: { type: 'string', pattern: uuid } },
  allowedModels: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 } },
  allowAllModels: { type: 'boolean' },
} as const

const workspaceProvidersSchema = {
  type: 'object',
  properties: workspaceProvidersProperties,
  required: ['loginIds', 'allowedModels', 'allowAllModels'],
} as const

const workspaceProvidersBody = workspaceProvidersSchema

const usageSchema = {
  type: 'object',
  properties: {
    provider: { type: 'string' },
    loginCount: { type: 'integer' },
    requests: { type: 'integer' },
    inputTokens: { type: 'integer' },
    outputTokens: { type: 'integer' },
    costUsd: { type: 'number' },
  },
  required: ['provider', 'loginCount', 'requests', 'inputTokens', 'outputTokens', 'costUsd'],
} as const

const usageListSchema = {
  type: 'object',
  properties: { usage: { type: 'array', items: usageSchema } },
  required: ['usage'],
} as const

export const providerRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  const { providers } = options.agent

  server.get(
    '/providers/logins',
    { schema: { response: { 200: loginListSchema } } },
    async () => ({ logins: await providers.logins() }),
  )

  server.get(
    '/providers/models',
    { schema: { response: { 200: modelListSchema } } },
    async () => ({ models: await providers.models() }),
  )

  server.get<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/providers',
    { schema: { params: workspaceIdParams, response: { 200: workspaceProvidersSchema } } },
    async (request) => providers.workspaceProviders(request.params.workspaceId),
  )

  // A replace, not a patch: the body is the whole selection, so a client cannot half-apply one.
  server.put<{ Params: { workspaceId: string }; Body: WorkspaceProviders }>(
    '/workspaces/:workspaceId/providers',
    { schema: { params: workspaceIdParams, body: workspaceProvidersBody, response: { 200: workspaceProvidersSchema } } },
    async (request) => providers.setWorkspaceProviders(request.params.workspaceId, request.body),
  )

  server.get<{ Params: { workspaceId: string } }>(
    '/workspaces/:workspaceId/providers/usage',
    { schema: { params: workspaceIdParams, response: { 200: usageListSchema } } },
    async (request) => ({ usage: await providers.usage(request.params.workspaceId) }),
  )
}
