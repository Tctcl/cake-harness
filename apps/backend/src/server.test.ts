import { describe, expect, it } from 'vitest'

import { buildServer } from './server.js'

describe('GET /ping', () => {
  it('responds with pong', async () => {
    const server = buildServer()

    try {
      const response = await server.inject({ method: 'GET', url: '/ping' })

      expect(response.statusCode).toBe(200)
      expect(response.body).toBe('pong\n')
    } finally {
      await server.close()
    }
  })
})
