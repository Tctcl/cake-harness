import type { FastifyPluginAsync } from 'fastify'

import type { Agent } from '../agent.js'

const userSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, name: { type: 'string' } },
  required: ['id', 'name'],
} as const

/**
 * Who the client is looking at. Until sign-in exists there is one local user, so this answers with the seeded row rather
 * than with a session: the sidebar's identity block and the settings page read it, and nothing here is authenticated.
 */
export const meRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  server.get('/me', { schema: { response: { 200: userSchema } } }, async () => options.agent.me())
}
