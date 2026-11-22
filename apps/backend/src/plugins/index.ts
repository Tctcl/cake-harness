import type { FastifyInstance } from 'fastify'

import type { Agent } from '../agent.js'
import type { Config } from '../config.js'
import { registerErrorHandling } from '../error-handler.js'
import { chatRoutes } from '../routes/chat.js'
import { healthRoutes } from '../routes/health.js'

export interface PluginOptions {
  readonly agent: Agent
}

// Single registration point: error handling first, then plugins that add routes.
export async function registerPlugins(
  server: FastifyInstance,
  config: Config,
  options: PluginOptions,
): Promise<void> {
  registerErrorHandling(server, { exposeDetails: config.nodeEnv !== 'production' })

  await server.register(healthRoutes)
  await server.register(chatRoutes, { agent: options.agent })
}
