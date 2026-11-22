import type { FastifyPluginAsync } from 'fastify'

const healthResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    uptime: { type: 'number' },
    timestamp: { type: 'string' },
  },
  required: ['status', 'uptime', 'timestamp'],
} as const

export const healthRoutes: FastifyPluginAsync = async (server) => {
  server.get('/health', { schema: { response: { 200: healthResponseSchema } } }, async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))
}
