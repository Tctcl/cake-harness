import type { FastifyPluginAsync } from 'fastify'

import type { Actor } from '../auth/actor.js'
import { clearedSessionCookie, sessionCookie } from '../auth/cookie.js'
import { AuthService } from '../auth/service.js'
import { AppError } from '../errors.js'
import type { Agent } from '../agent.js'

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

const credentialsSchema = {
  type: 'object',
  properties: { username: { type: 'string' }, password: { type: 'string' } },
  required: ['username', 'password'],
} as const

const codeSchema = {
  type: 'object',
  properties: { code: { type: 'string' } },
  required: ['code'],
} as const

const actorSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    username: { type: ['string', 'null'] },
    permissions: { type: 'array', items: { type: 'string' } },
    pending: { type: ['string', 'null'] },
    singleUser: { type: 'boolean' },
  },
  required: ['id', 'name', 'username', 'permissions', 'pending', 'singleUser'],
} as const

export const toActorPayload = (actor: Actor) => ({
  id: actor.id,
  name: actor.displayName,
  username: actor.username,
  permissions: [...actor.permissions],
  pending: actor.pending,
  singleUser: actor.singleUser,
})

const secure = (request: { readonly protocol: string }): boolean => request.protocol === 'https'

/**
 * Signing in, signing out, and the two places a password is set. Everything here is deliberately reachable while a
 * session is half-signed-in — that is the state `pending` describes, and these are the routes that end it.
 */
export const authRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  const auth = (): AuthService => options.agent.auth

  server.post(
    '/auth/login',
    { config: { public: true }, schema: { body: credentialsSchema } },
    async (request, reply) => {
      const body = request.body as { username: string; password: string }
      const result = await auth().login(body.username, body.password)

      reply.header(
        'set-cookie',
        sessionCookie(result.token, secure(request), SESSION_MAX_AGE_SECONDS),
      )

      return toActorPayload(result.actor)
    },
  )

  server.post('/auth/logout', async (request, reply) => {
    await auth().logout(request.actor.sessionId)
    reply.header('set-cookie', clearedSessionCookie(secure(request)))

    return reply.status(204).send()
  })

  // Readable while pending: the client needs to know which step to draw.
  server.get('/auth/session', { schema: { response: { 200: actorSchema } } }, async (request) =>
    toActorPayload(request.actor),
  )

  server.post('/auth/2fa/verify', { schema: { body: codeSchema } }, async (request, reply) => {
    if (request.actor.pending !== 'totp') {
      throw new AppError('No second factor is waiting.', { statusCode: 409, code: 'auth.no_step' })
    }

    await auth().completeSecondFactor(request.actor, (request.body as { code: string }).code)
    reply.status(204)

    return reply.send()
  })
}
