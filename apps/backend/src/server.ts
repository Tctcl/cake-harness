import fastify, { type FastifyInstance } from 'fastify'

import type { Config } from './config.js'
import { registerPlugins } from './plugins/index.js'

export function buildServer(config: Config): FastifyInstance {
  const server = fastify({
    logger: config.nodeEnv === 'test' ? false : { level: config.logLevel },
  })

  void registerPlugins(server, config)

  return server
}
