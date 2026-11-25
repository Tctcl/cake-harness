import type { FastifyPluginAsync } from 'fastify'

import type { ActorPayload } from '../auth/actor-payload.js'
import { toActorPayload } from '../auth/actor-payload.js'
import type { Agent } from '../agent.js'

const actorSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    username: { type: ['string', 'null'] },
    permissions: { type: 'array', items: { type: 'string' } },
    pending: { type: ['string', 'null'] },
    singleUser: { type: 'boolean' },
  },
  required: ['id', 'name', 'username', 'permissions', 'pending', 'singleUser'],
} as const

/**
 * Who the client is looking at, and what the client may offer them. The sidebar reads the name, the settings screens
 * read the permissions to decide what to draw — and never to decide what is allowed, which the routes do themselves.
 */
export const meRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server) => {
  server.get('/me', { schema: { response: { 200: actorSchema } } }, async (request): Promise<ActorPayload> =>
    toActorPayload(request.actor),
  )
}
