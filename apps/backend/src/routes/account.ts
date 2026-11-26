import type { FastifyPluginAsync } from 'fastify'

import { AuthService } from '../auth/service.js'
import { AppError } from '../errors.js'
import type { Agent } from '../agent.js'

const sshKeyName = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' } as const

const sshKeyProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  publicKey: { type: 'string' },
  fingerprint: { type: 'string' },
  createdAt: { type: 'string' },
} as const

const sshKeySchema = {
  type: 'object',
  properties: sshKeyProperties,
  required: ['id', 'name', 'publicKey', 'fingerprint', 'createdAt'],
} as const

const sshKeyListSchema = {
  type: 'object',
  properties: { keys: { type: 'array', items: sshKeySchema } },
  required: ['keys'],
} as const

const sshKeyIdParams = {
  type: 'object',
  properties: {
    keyId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
  },
  required: ['keyId'],
  additionalProperties: false,
} as const

const gitIdentitySchema = {
  type: 'object',
  properties: { name: { type: 'string' }, email: { type: 'string' } },
  required: ['name', 'email'],
} as const

const passwordSchema = {
  type: 'object',
  properties: { current: { type: 'string' }, next: { type: 'string' } },
  required: ['current', 'next'],
} as const

const initialPasswordSchema = {
  type: 'object',
  properties: { password: { type: 'string' } },
  required: ['password'],
} as const

const codeSchema = {
  type: 'object',
  properties: { code: { type: 'string' } },
  required: ['code'],
} as const

const setupSchema = {
  type: 'object',
  properties: { secret: { type: 'string' }, uri: { type: 'string' } },
  required: ['secret', 'uri'],
} as const

/**
 * The signed-in person's own account. Nothing here needs a permission: changing your password and managing your second
 * factor are things the account owns, not capabilities somebody granted.
 */
export const accountRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  const auth = (): AuthService => options.agent.auth
  const sshKeys = options.agent.sshKeys

  server.get('/account/git', { schema: { response: { 200: gitIdentitySchema } } }, async (request) => {
    AuthService.assertSignedIn(request.actor)
    const user = await auth().users.findById(request.actor.id)

    return { name: user?.gitName ?? user?.displayName ?? '', email: user?.gitEmail ?? '' }
  })

  server.put<{ Body: { name: string; email: string } }>(
    '/account/git',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 200 },
            email: { type: 'string', maxLength: 320 },
          },
          required: ['name', 'email'],
          additionalProperties: false,
        },
        response: { 200: gitIdentitySchema },
      },
    },
    async (request) => {
      AuthService.assertSignedIn(request.actor)
      const user = await auth().users.setGitIdentity(
        request.actor.id,
        request.body.name.trim(),
        request.body.email.trim(),
      )
      if (user === undefined) throw new AppError('the account does not exist', { statusCode: 404, code: 'ACCOUNT_NOT_FOUND' })

      return { name: user.gitName ?? '', email: user.gitEmail ?? '' }
    },
  )

  server.get('/account/ssh-keys', { schema: { response: { 200: sshKeyListSchema } } }, async (request) => {
    AuthService.assertSignedIn(request.actor)

    return { keys: await sshKeys.list() }
  })

  server.post<{ Body: { name: string; publicKey: string } }>(
    '/account/ssh-keys',
    {
      schema: {
        body: {
          type: 'object',
          properties: { name: sshKeyName, publicKey: { type: 'string', minLength: 1, maxLength: 16_384 } },
          required: ['name', 'publicKey'],
          additionalProperties: false,
        },
        response: { 201: sshKeySchema },
      },
    },
    async (request, reply) => {
      AuthService.assertSignedIn(request.actor)

      return reply.code(201).send(await sshKeys.upload(request.body.name, request.body.publicKey))
    },
  )

  server.post<{ Body: { name: string } }>(
    '/account/ssh-keys/generate',
    {
      schema: {
        body: {
          type: 'object',
          properties: { name: sshKeyName },
          required: ['name'],
          additionalProperties: false,
        },
        response: {
          201: {
            type: 'object',
            properties: {
              key: sshKeySchema,
              privateKey: { type: 'string' },
              filename: { type: 'string', const: 'cake_ed25519' },
            },
            required: ['key', 'privateKey', 'filename'],
          },
        },
      },
    },
    async (request, reply) => {
      AuthService.assertSignedIn(request.actor)

      return reply.code(201).send(await sshKeys.generate(request.body.name))
    },
  )

  server.delete<{ Params: { keyId: string } }>(
    '/account/ssh-keys/:keyId',
    { schema: { params: sshKeyIdParams } },
    async (request, reply) => {
      AuthService.assertSignedIn(request.actor)
      if (!(await sshKeys.remove(request.params.keyId))) {
        throw new AppError('the SSH key does not exist', { statusCode: 404, code: 'SSH_KEY_NOT_FOUND' })
      }

      return reply.code(204).send()
    },
  )

  // The only route a session with `pending === 'password'` may reach: the password an admin set is about to be replaced.
  server.post('/auth/password/initial', { schema: { body: initialPasswordSchema } }, async (request, reply) => {
    if (request.actor.pending !== 'password') {
      throw new AppError('No password change is waiting.', { statusCode: 409, code: 'auth.no_step' })
    }

    await auth().setInitialPassword(request.actor, (request.body as { password: string }).password)
    reply.status(204)

    return reply.send()
  })

  server.post('/auth/password/change', { schema: { body: passwordSchema } }, async (request, reply) => {
    AuthService.assertSignedIn(request.actor)
    const body = request.body as { current: string; next: string }

    await auth().changePassword(request.actor, body.current, body.next)
    reply.status(204)

    return reply.send()
  })

  server.post('/auth/2fa/setup', { schema: { response: { 200: setupSchema } } }, async (request) => {
    AuthService.assertSignedIn(request.actor)

    return auth().startTotpSetup(request.actor)
  })

  server.post('/auth/2fa/enable', { schema: { body: codeSchema } }, async (request, reply) => {
    await auth().confirmTotp(request.actor, (request.body as { code: string }).code)
    reply.status(204)

    return reply.send()
  })

  server.post('/auth/2fa/disable', { schema: { body: credentialsSchemaLike() } }, async (request, reply) => {
    AuthService.assertSignedIn(request.actor)

    await auth().disableTotp(request.actor, (request.body as { password: string }).password)
    reply.status(204)

    return reply.send()
  })
}

function credentialsSchemaLike() {
  return {
    type: 'object',
    properties: { password: { type: 'string' } },
    required: ['password'],
  } as const
}
