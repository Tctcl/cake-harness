import fastify, { type FastifyInstance } from 'fastify'

export function buildServer(): FastifyInstance {
  const server = fastify()

  server.get('/ping', async () => {
    return 'pong\n'
  })

  return server
}
