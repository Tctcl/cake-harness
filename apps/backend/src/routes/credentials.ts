import type { FastifyPluginAsync } from 'fastify'

import type { Agent } from '../agent.js'
import type { CredentialApi } from '../credentials/api.js'
import type { Credential, CredentialInput, CredentialKind } from '../credentials/credential-repository.js'
import { AppError } from '../errors.js'

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

const credentialIdParams = {
  type: 'object',
  properties: { credentialId: { type: 'string', pattern: uuid } },
  required: ['credentialId'],
  additionalProperties: false,
} as const

/**
 * The secret is a required field and never part of a response, so it is declared here and only here. `expiresAt: null`
 * is a key that does not expire; omitting it is the same thing.
 */
const createBody = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['opencode-go', 'mcp'] },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    value: { type: 'string', minLength: 1, maxLength: 4096 },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
    email: { type: ['string', 'null'], minLength: 3, maxLength: 320 },
    note: { type: ['string', 'null'], maxLength: 2000 },
    mcpId: { type: ['string', 'null'], maxLength: 200 },
  },
  required: ['kind', 'name', 'value'],
  additionalProperties: false,
} as const

const credentialProperties = {
  id: { type: 'string' },
  kind: { type: 'string', enum: ['opencode-go', 'mcp'] },
  name: { type: 'string' },
  expiresAt: { type: ['string', 'null'] },
  email: { type: ['string', 'null'] },
  note: { type: ['string', 'null'] },
  mcpId: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
} as const

const credentialSchema = {
  type: 'object',
  properties: credentialProperties,
  required: ['id', 'kind', 'name', 'expiresAt', 'email', 'note', 'mcpId', 'createdAt', 'updatedAt'],
} as const

const credentialListSchema = {
  type: 'object',
  properties: { credentials: { type: 'array', items: credentialSchema } },
  required: ['credentials'],
} as const

const badRequest = (message: string, code: string): AppError =>
  new AppError(message, { statusCode: 400, code })

/**
 * The fields a kind needs are the fields it may carry, so the shape is decided here rather than left to the table's
 * check constraint: a client that sends the wrong pair gets a 400 that names it, not a 500 from the database.
 */
const toInput = (body: {
  kind: CredentialKind
  name: string
  value: string
  expiresAt?: string | null
  email?: string | null
  note?: string | null
  mcpId?: string | null
}): CredentialInput => {
  const base = { kind: body.kind, name: body.name, value: body.value, expiresAt: body.expiresAt ?? null }

  if (body.kind === 'opencode-go') {
    if (typeof body.email !== 'string' || body.email.trim() === '') {
      throw badRequest('an opencode-go key names the account it belongs to', 'CREDENTIAL_EMAIL_REQUIRED')
    }

    return { ...base, email: body.email.trim() }
  }

  if (typeof body.mcpId !== 'string' || body.mcpId.trim() === '') {
    throw badRequest('an mcp key names the server it answers for', 'CREDENTIAL_MCP_REQUIRED')
  }

  return { ...base, mcpId: body.mcpId.trim(), note: body.note ?? null }
}

export const credentialRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  const credentials: CredentialApi = options.agent.credentials

  server.get<Record<string, never>>('/credentials', { schema: { response: { 200: credentialListSchema } } }, async () => ({
    credentials: (await credentials.list()) satisfies Credential[],
  }))

  server.post<{
    Body: {
      kind: CredentialKind
      name: string
      value: string
      expiresAt?: string | null
      email?: string | null
      note?: string | null
      mcpId?: string | null
    }
  }>('/credentials', { schema: { body: createBody, response: { 201: credentialSchema } } }, async (request, reply) => {
    const credential = await credentials.create(toInput(request.body))

    return reply.code(201).send(credential)
  })

  server.delete<{ Params: { credentialId: string } }>(
    '/credentials/:credentialId',
    { schema: { params: credentialIdParams } },
    async (request, reply) => {
      const removed = await credentials.remove(request.params.credentialId)
      if (!removed) throw new AppError('the credential does not exist', { statusCode: 404, code: 'CREDENTIAL_NOT_FOUND' })

      return reply.code(204).send()
    },
  )
}
