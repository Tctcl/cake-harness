import type { FastifyPluginAsync } from 'fastify'

import { AuthService } from '../auth/service.js'
import type { Settings } from '../auth/settings-repository.js'
import { DEFAULT_SETTINGS } from '../auth/settings-repository.js'
import type { Agent } from '../agent.js'
import { THINKING_LEVELS } from '../agents/agent-repository.js'
import { validateBackgroundModel } from '../background/model-chain.js'

const backgroundModelSchema = {
  type: 'array',
  maxItems: 20,
  items: {
    type: 'object',
    properties: {
      credentialId: { type: 'string', minLength: 1 },
      modelId: { type: 'string', minLength: 1, maxLength: 200 },
      thinkingLevel: { type: 'string', enum: [...THINKING_LEVELS] },
    },
    required: ['credentialId', 'modelId', 'thinkingLevel'],
    additionalProperties: false,
  },
} as const

const settingsSchema = {
  type: 'object',
  properties: {
    singleUser: { type: 'boolean' },
    requireTwoFactor: { type: 'boolean' },
    systemPrompt: { type: 'string' },
    defaultSystemPrompt: { type: 'string' },
    subagentSystemPrompt: { type: 'string' },
    defaultSubagentSystemPrompt: { type: 'string' },
    backgroundModel: backgroundModelSchema,
  },
  required: [
    'singleUser',
    'requireTwoFactor',
    'systemPrompt',
    'defaultSystemPrompt',
    'subagentSystemPrompt',
    'defaultSubagentSystemPrompt',
    'backgroundModel',
  ],
} as const

const patchSchema = {
  type: 'object',
  properties: {
    singleUser: { type: 'boolean' },
    requireTwoFactor: { type: 'boolean' },
    systemPrompt: { type: 'string' },
    subagentSystemPrompt: { type: 'string' },
    backgroundModel: backgroundModelSchema,
  },
  additionalProperties: false,
} as const

type SettingsPatch = Partial<
  Pick<
    Settings,
    'singleUser' | 'requireTwoFactor' | 'systemPrompt' | 'subagentSystemPrompt' | 'backgroundModel'
  >
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

      if (request.body.backgroundModel !== undefined) {
        const [logins, models] = await Promise.all([
          options.agent.providers.logins(),
          options.agent.providers.models(),
        ])
        validateBackgroundModel(request.body.backgroundModel, {
          loginIds: logins.map((login) => login.id),
          modelIds: new Set(models.map((model) => model.id)),
        })
      }

      return withDefaultPrompt(await auth().updateSettings(request.actor, request.body))
    },
  )
}
