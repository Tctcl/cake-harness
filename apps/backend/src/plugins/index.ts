import type { FastifyInstance } from 'fastify'

import type { Agent } from '../agent.js'
import type { Config } from '../config.js'
import { registerErrorHandling } from '../error-handler.js'
import { healthRoutes } from '../routes/health.js'
import { meRoutes } from '../routes/me.js'
import { capabilityRoutes } from '../routes/capabilities.js'
import { environmentRoutes } from '../routes/environments.js'
import { registerStatic } from '../static.js'
import { threadRoutes } from '../routes/threads.js'
import { updateRoutes } from '../routes/updates.js'
import { workspaceRoutes } from '../routes/workspaces.js'

export interface PluginOptions {
  readonly agent: Agent
}

// Single registration point: static files and error handling happen in this tick, because the SPA fallback is a
// not-found handler and those only take effect before the instance boots. Routes follow.
export async function registerPlugins(
  server: FastifyInstance,
  config: Config,
  options: PluginOptions,
): Promise<void> {
  const sendIndex = registerStatic(server, config.frontendDir)

  registerErrorHandling(server, {
    exposeDetails: config.nodeEnv !== 'production',
    sendIndex,
  })

  await server.register(healthRoutes)
  await server.register(meRoutes, { agent: options.agent })
  await server.register(threadRoutes, { agent: options.agent })
  await server.register(workspaceRoutes, { agent: options.agent })
  await server.register(capabilityRoutes, { agent: options.agent })
  await server.register(environmentRoutes, { agent: options.agent })
  await server.register(updateRoutes, { agent: options.agent })
}
