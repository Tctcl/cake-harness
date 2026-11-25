import type { FastifyPluginAsync } from 'fastify'

import { AuthService } from '../auth/service.js'
import type { Agent } from '../agent.js'

const settingsSchema = {
  type: 'object',
  properties: { singleUser: { type: 'boolean' }, requireTwoFactor: { type: 'boolean' } },
  required: ['singleUser', 'requireTwoFactor'],
} as const

const patchSchema = {
  type: 'object',
  properties: { singleUser: { type: 'boolean' }, requireTwoFactor: { type: 'boolean' } },
  additionalProperties: false,
} as const

export const settingsRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  const auth = (): AuthService => options.agent.auth

  // The only unauthenticated read in the app: the client cannot draw a login screen before it knows whether to.
  server.get('/settings/public', { config: { public: true } }, async () => {
    const settings = await auth().currentSettings()

    return { singleUser: settings.singleUser }
  })

  server.get('/settings', { schema: { response: { 200: settingsSchema } } }, async (request) => {
    AuthService.assertSignedIn(request.actor)
    AuthService.assertCan(request.actor, 'settings.manage')

    return auth().currentSettings()
  })

  server.put('/settings', { schema: { body: patchSchema } }, async (request) => {
    AuthService.assertSignedIn(request.actor)
    AuthService.assertCan(request.actor, 'settings.manage')

    return auth().updateSettings(request.actor, request.body as { singleUser?: boolean; requireTwoFactor?: boolean })
  })
}
