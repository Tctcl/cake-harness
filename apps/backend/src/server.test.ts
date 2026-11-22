import { describe, expect, it } from 'vitest'

import type { Agent } from './agent.js'
import { loadConfig } from './config.js'
import { AppError } from './errors.js'
import { buildServer } from './server.js'

const config = loadConfig({ NODE_ENV: 'test' })

function stubAgent(ask: Agent['ask']): Agent {
  return { ask, close: async () => {} }
}

const agent = stubAgent(async (input) => `echo: ${input}`)

describe('GET /health', () => {
  it('responds with the service status', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({ method: 'GET', url: '/health' })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ status: string; uptime: number; timestamp: string }>()
      expect(body.status).toBe('ok')
      expect(body.uptime).toBeGreaterThanOrEqual(0)
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
    } finally {
      await server.close()
    }
  })
})

describe('error handling', () => {
  it('responds with a structured 404 for unknown routes', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({ method: 'GET', url: '/ping' })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        error: { code: 'NOT_FOUND', message: 'Route GET /ping not found' },
      })
    } finally {
      await server.close()
    }
  })

  it('responds with the declared status and code for an AppError', async () => {
    const server = buildServer(config, { agent })
    server.get('/teapot', async () => {
      throw new AppError('Not brewing today', { statusCode: 418, code: 'TEAPOT' })
    })

    try {
      const response = await server.inject({ method: 'GET', url: '/teapot' })

      expect(response.statusCode).toBe(418)
      expect(response.json()).toEqual({
        error: { code: 'TEAPOT', message: 'Not brewing today' },
      })
    } finally {
      await server.close()
    }
  })

  it('hides unexpected error details in production', async () => {
    const productionServer = buildServer(loadConfig({ NODE_ENV: 'production', LOG_LEVEL: 'silent' }), { agent })
    productionServer.get('/boom', async () => {
      throw new Error('database credentials rejected')
    })

    try {
      const response = await productionServer.inject({ method: 'GET', url: '/boom' })

      expect(response.statusCode).toBe(500)
      expect(response.json()).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      })
    } finally {
      await productionServer.close()
    }
  })
})

describe('POST /chat', () => {
  it('answers with what the agent replied', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/chat',
        payload: { message: 'hello' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ reply: 'echo: hello' })
    } finally {
      await server.close()
    }
  })

  it('rejects an empty message', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/chat',
        payload: { message: '' },
      })

      expect(response.statusCode).toBe(400)
    } finally {
      await server.close()
    }
  })
})
