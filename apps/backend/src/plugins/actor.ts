import type { FastifyInstance } from 'fastify'

import { readCookie, SESSION_COOKIE } from '../auth/cookie.js'
import { AuthService } from '../auth/service.js'
import type { AuthService as AuthServiceType } from '../auth/service.js'
import { AppError } from '../errors.js'

/**
 * Turns the cookie into an identity once, for every route, instead of in each handler.
 *
 * This is a function rather than a plugin on purpose: a hook added inside `register` is encapsulated to that plugin's
 * children, so it would never run for the route plugins registered beside it. The error handler has the same constraint.
 *
 * It is a `preHandler` rather than an `onRequest` hook for the other half of the same care: a `preHandler` only runs for
 * a route that matched, so the SPA fallback still hands `index.html` to a browser that has no session yet.
 */
export const registerActor = (server: FastifyInstance, auth: AuthServiceType): void => {
  server.addHook('preHandler', async (request) => {
    const config = request.routeOptions.config

    if (config.public === true) return

    const token = readCookie(request.headers.cookie, SESSION_COOKIE)
    const actor = await auth.resolve(token)

    if (actor === undefined) {
      throw new AppError('Sign in to continue.', { statusCode: 401, code: 'auth.unauthenticated' })
    }

    request.actor = actor

    if (config.permission !== undefined) {
      // A half-signed-in session holds no permissions, so this refuses it too: signing in finishes before anything else.
      AuthService.assertCan(actor, config.permission)
    }
  })
}
