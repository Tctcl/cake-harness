import type { FastifyPluginAsync } from 'fastify'

import { AuthService } from '../auth/service.js'
import type { Settings } from '../auth/settings-repository.js'
import { DEFAULT_SETTINGS } from '../auth/settings-repository.js'
import type { Agent } from '../agent.js'

const settingsSchema = {
  type: 'object',
  properties: {
    singleUser: { type: 'boolean' },
    requireTwoFactor: { type: 'boolean' },
    systemPrompt: { type: 'string' },
    defaultSystemPrompt: { type: 'string' },
    subagentSystemPrompt: { type: 'string' },
    defaultSubagentSystemPrompt: { type: 'string' },
  },
  required: [
    'singleUser',
    'requireTwoFactor',
    'systemPrompt',
    'defaultSystemPrompt',
    'subagentSystemPrompt',
    'defaultSubagentSystemPrompt',
  ],
} as const

const patchSchema = {
  type: 'object',
  properties: {
    singleUser: { type: 'boolean' },
    requireTwoFactor: { type: 'boolean' },
    systemPrompt: { type: 'string' },
    subagentSystemPrompt: { type: 'string' },
  },
  additionalProperties: false,
} as const

type SettingsPatch = Partial<
  Pick<Settings, 'singleUser' | 'requireTwoFactor' | 'systemPrompt' | 'subagentSystemPrompt'>
>

const withDefaultPrompt = (settings: Settings) => ({
  ...settings,
  defaultSystemPrompt: DEFAULT_SETTINGS.systemPrompt,
  defaultSubagentSystemPrompt: DEFAULT_SETTINGS.subagentSystemPrompt,
})

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

    return withDefaultPrompt(await auth().currentSettings())
  })

  server.put<{ Body: SettingsPatch }>(
    '/settings',
    { schema: { body: patchSchema, response: { 200: settingsSchema } } },
    async (request) => {
      AuthService.assertSignedIn(request.actor)
      AuthService.assertCan(request.actor, 'settings.manage')

      return withDefaultPrompt(await auth().updateSettings(request.actor, request.body))
    },
  )
}
