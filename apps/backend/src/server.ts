import fastify, { type FastifyInstance } from 'fastify'

import type { Agent } from './agent.js'
import type { Config } from './config.js'
import { registerPlugins } from './plugins/index.js'

export interface ServerOptions {
  readonly agent: Agent
}

export function buildServer(config: Config, options: ServerOptions): FastifyInstance {
  const server = fastify({
    logger: config.nodeEnv === 'test' ? false : { level: config.logLevel },
  })

  void registerPlugins(server, config, { agent: options.agent })

  return server
}
