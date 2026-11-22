import type { FastifyInstance } from 'fastify'

import type { Agent } from '../agent.js'
import type { Config } from '../config.js'
import { registerErrorHandling } from '../error-handler.js'
import { healthRoutes } from '../routes/health.js'
import { meRoutes } from '../routes/me.js'
import { capabilityRoutes } from '../routes/capabilities.js'
import { threadRoutes } from '../routes/threads.js'
import { workspaceRoutes } from '../routes/workspaces.js'

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
  await server.register(meRoutes, { agent: options.agent })
  await server.register(threadRoutes, { agent: options.agent })
  await server.register(workspaceRoutes, { agent: options.agent })
  await server.register(capabilityRoutes, { agent: options.agent })
}
