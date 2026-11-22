import fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'

import type { Agent } from './agent.js'
import type { Config } from './config.js'
import { registerPlugins } from './plugins/index.js'

export interface ServerOptions {
  readonly agent: Agent
}

// Pretty output is a development convenience only: production keeps the JSON pino
// writes so log collectors can parse it, and tests keep the logger off entirely.
function loggerOptions(config: Config): NonNullable<FastifyServerOptions['logger']> {
  if (config.nodeEnv === 'test') {
    return false
  }

  if (config.nodeEnv !== 'development') {
    return { level: config.logLevel }
  }

  return {
    level: config.logLevel,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  }
}

export function buildServer(config: Config, options: ServerOptions): FastifyInstance {
  const server = fastify({ logger: loggerOptions(config) })

  void registerPlugins(server, config, { agent: options.agent })

  return server
}
