import type { FastifyInstance } from 'fastify'

import type { Config } from '../config.js'
import { registerErrorHandling } from '../error-handler.js'
import { healthRoutes } from '../routes/health.js'

// Single registration point: error handling first, then plugins that add routes.
export async function registerPlugins(server: FastifyInstance, config: Config): Promise<void> {
  registerErrorHandling(server, { exposeDetails: config.nodeEnv !== 'production' })

  await server.register(healthRoutes)
}
