import type { FastifyPluginAsync } from 'fastify'

import type { Agent } from '../agent.js'

const chatRequestSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', minLength: 1 },
  },
  required: ['message'],
  additionalProperties: false,
} as const

const chatResponseSchema = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
  },
  required: ['reply'],
} as const

interface ChatRequest {
  message: string
}

export const chatRoutes: FastifyPluginAsync<{ agent: Agent }> = async (server, options) => {
  server.post<{ Body: ChatRequest }>(
    '/chat',
    { schema: { body: chatRequestSchema, response: { 200: chatResponseSchema } } },
    async (request) => ({ reply: await options.agent.ask(request.body.message) }),
  )
}
