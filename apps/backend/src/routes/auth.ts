import type { FastifyPluginAsync } from 'fastify'

import type { Actor } from '../auth/actor.js'
import { clearedSessionCookie, sessionCookie } from '../auth/cookie.js'
import { LoginThrottle } from '../auth/login-throttle.js'
import { AuthService, SESSION_TTL_MS } from '../auth/service.js'
import type { LoginResult } from '../auth/service.js'
import { AppError } from '../errors.js'
import type { Agent } from '../agent.js'

const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000

const credentialsSchema = {
  type: 'object',
  properties: { username: { type: 'string' }, password: { type: 'string' } },
  required: ['username', 'password'],
  additionalProperties: false,
} as const

interface Credentials {
  readonly username: string
  readonly password: string
}

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
  // Per server instance, so each test gets its own count; production has one instance.
  const throttle = new LoginThrottle()

  server.post<{ Body: Credentials }>(
    '/auth/login',
    { config: { public: true }, schema: { body: credentialsSchema } },
    async (request, reply) => {
      // The address Fastify resolved: the proxy's X-Forwarded-For when TRUST_PROXY is on, the socket otherwise.
      const retryAfterMs = throttle.retryAfterMs(request.ip)
      if (retryAfterMs > 0) {
        reply.header('retry-after', String(Math.ceil(retryAfterMs / 1000)))
        throw new AppError('Too many failed sign-ins. Try again later.', {
          statusCode: 429,
          code: 'auth.too_many_attempts',
        })
      }

      let result: LoginResult
      try {
        result = await auth().login(request.body.username, request.body.password)
      } catch (error) {
        if (error instanceof AppError && error.code === 'auth.invalid_credentials') throttle.recordFailure(request.ip)
        throw error
      }
      throttle.recordSuccess(request.ip)

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

  server.post<{ Body: { readonly code: string } }>('/auth/2fa/verify', { schema: { body: codeSchema } }, async (request, reply) => {
    if (request.actor.pending !== 'totp') {
      throw new AppError('No second factor is waiting.', { statusCode: 409, code: 'auth.no_step' })
    }

    await auth().completeSecondFactor(request.actor, request.body.code)
    reply.status(204)

    return reply.send()
  })
}
