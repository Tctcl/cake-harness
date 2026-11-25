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
  // Behind Traefik the client's address and protocol arrive in X-Forwarded-*. Believing them is what makes the session
  // cookie `Secure` and gives the login throttle the client's address rather than the proxy's.
  const server = fastify({ logger: loggerOptions(config), trustProxy: config.trustProxy })

  // Registration is async (it awaits the websocket plugin before the routes that upgrade), but callers need the instance
  // synchronously. A failure must still stop the server: it is held here and rethrown from `ready()`, which `listen()`
  // and `inject()` both wait on, instead of surfacing as an unhandled rejection while a half-registered server boots.
  let failure: unknown
  const registration = registerPlugins(server, config, { agent: options.agent }).catch((error: unknown) => {
    failure = error
  })
  server.addHook('onReady', async () => {
    await registration
    if (failure !== undefined) throw failure
  })

  return server
}
