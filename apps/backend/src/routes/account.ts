import type { FastifyPluginAsync } from 'fastify'

import { AuthService } from '../auth/service.js'
import { AppError } from '../errors.js'
import type { Agent } from '../agent.js'

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
