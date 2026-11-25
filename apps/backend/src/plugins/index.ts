import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'

import type { Agent } from '../agent.js'
import type { Config } from '../config.js'
import { registerErrorHandling } from '../error-handler.js'
import { accountRoutes } from '../routes/account.js'
import { authRoutes } from '../routes/auth.js'
import { roleRoutes } from '../routes/roles.js'
import { settingsRoutes } from '../routes/settings.js'
import { userRoutes } from '../routes/users.js'
import { registerActor } from './actor.js'
import { healthRoutes } from '../routes/health.js'
import { meRoutes } from '../routes/me.js'
import { capabilityRoutes } from '../routes/capabilities.js'
import { credentialRoutes } from '../routes/credentials.js'
import { providerRoutes } from '../routes/providers.js'
import { environmentRoutes } from '../routes/environments.js'
import { terminalRoutes } from '../routes/terminals.js'
import { registerStatic } from '../static.js'
import { threadRoutes } from '../routes/threads.js'
import { updateRoutes } from '../routes/updates.js'
import { workspaceRoutes } from '../routes/workspaces.js'
import { DockerPtys } from '../terminal/pty.js'
import { TerminalSessions } from '../terminal/sessions.js'

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

  // Before every route: it resolves the session once, and a route that wants a permission reads the actor the hook set.
  // On the root instance, not in a plugin: a hook inside `register` would only see that plugin's own children.
  registerActor(server, options.agent.auth)

  // Before the routes that upgrade: the plugin owns the upgrade listener, so registering it later would leave those
  // routes answering a plain GET.
  await server.register(websocket)

  /**
   * Sessions live in this process, so they are owned here rather than by a plugin that could be registered twice. The
   * shell is bash when the image has it and `sh` otherwise, because an environment may run any image Cake
   * publishes.
   */
  const terminals = new TerminalSessions({
    ptys: new DockerPtys(config.docker),
    limits: config.terminals,
    command: ['/bin/sh', '-c', 'exec bash -l || exec sh -l'],
  })
  server.addHook('onClose', async () => {
    await terminals.shutdown()
  })

  await server.register(healthRoutes)
  await server.register(settingsRoutes, { agent: options.agent })
  await server.register(authRoutes, { agent: options.agent })
  await server.register(accountRoutes, { agent: options.agent })
  await server.register(meRoutes, { agent: options.agent })
  await server.register(roleRoutes, { agent: options.agent })
  await server.register(userRoutes, { agent: options.agent })
  await server.register(threadRoutes, { agent: options.agent })
  await server.register(workspaceRoutes, { agent: options.agent })
  await server.register(capabilityRoutes, { agent: options.agent })
  await server.register(credentialRoutes, { agent: options.agent })
  await server.register(providerRoutes, { agent: options.agent })
  await server.register(environmentRoutes, { agent: options.agent, terminals })
  await server.register(terminalRoutes, { environments: options.agent.environments, terminals })
  await server.register(updateRoutes, { agent: options.agent })
}
