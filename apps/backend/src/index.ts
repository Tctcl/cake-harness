import { createAgent } from './agent.js'
import { ConfigError, loadConfig, type Config } from './config.js'
import { buildServer } from './server.js'

function readConfig(): Config {
  try {
    return loadConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }
}

const config = readConfig()
const agent = await createAgent()
const server = buildServer(config, { agent })

server.addHook('onClose', async () => {
  await agent.close()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.log.info({ signal }, 'shutting down')
    void server.close()
  })
}

try {
  await server.listen({ host: config.host, port: config.port })
} catch (error) {
  server.log.error({ err: error }, 'failed to start server')
  process.exit(1)
}
