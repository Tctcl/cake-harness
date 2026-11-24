import type { FastifyPluginAsync } from 'fastify'

import type { Agent } from '../agent.js'
import { releaseChannels } from '../config.js'

const updateSchema = {
  type: 'object',
  properties: {
    channel: { type: 'string', enum: [...releaseChannels] },
    current: { type: ['string', 'null'] },
    latest: { type: ['string', 'null'] },
    url: { type: ['string', 'null'] },
    available: { type: ['boolean', 'null'] },
    checkedAt: { type: ['string', 'null'] },
    error: { type: ['string', 'null'] },
  },
  required: ['channel', 'current', 'latest', 'url', 'available', 'checkedAt', 'error'],
} as const

export const updateRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  // Registered on `/updates` alone: the status has no id, there is one install, and the check is the only action.
  server.get('/updates', { schema: { response: { 200: updateSchema } } }, async () =>
    options.agent.updateStatus(),
  )

  // Forcing the check from the UI must not wait for the interval; concurrent callers share one request.
  server.post('/updates', { schema: { response: { 200: updateSchema } } }, async () =>
    options.agent.checkForUpdates(),
  )
}
