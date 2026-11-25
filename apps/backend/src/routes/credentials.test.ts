import { afterAll, describe, expect, it } from 'vitest'

import type { Agent } from '../agent.js'
import { AuthService } from '../auth/service.js'
import { loadConfig } from '../config.js'
import { createCredentialApi } from '../credentials/api.js'
import { CredentialRepository } from '../credentials/credential-repository.js'
import { buildServer } from '../server.js'
import { createPool } from '../storage/postgres/db.js'
import { createSchema, migrate } from '../storage/postgres/schema.js'
import { LOCAL_USER_ID } from '../threads/local-user.js'

/**
 * The credentials routes over the real repository and a real database: what the settings page sends, what it gets back,
 * and that a stored value never comes back out over HTTP.
 */
const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('credential routes (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const pools: ReturnType<typeof createPool>[] = []

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()))
  })

  const serve = async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url, SECRET_KEY: 'a-test-secret-key' })
    const pool = createPool(url, { max: 2 })
    pools.push(pool)
    const schema = createSchema(`cred${run}_${caseIndex++}_`)
    await migrate(pool, schema)
    const auth = new AuthService({ pool, schema, secrets: config.secrets })
    const credentials = createCredentialApi({
      ownerId: LOCAL_USER_ID,
      credentials: new CredentialRepository(pool, schema, config.secrets),
    })
    // Single-user mode, as a fresh install is: every request is the owner. The catalogs are looked up at registration.
    const agent = { auth, credentials, capabilities: { skills: {} } } as unknown as Agent

    return buildServer(config, { agent })
  }

  describe('credential routes', () => {
    it('stores a key, lists it without its value, and deletes it once', async () => {
      const server = await serve()
      try {
        const created = await server.inject({
          method: 'POST',
          url: '/credentials',
          payload: { kind: 'opencode-go', name: 'work', value: 'sk-never-returned', email: 'me@example.com' },
        })
        expect(created.statusCode).toBe(201)
        expect(created.body).not.toContain('sk-never-returned')
        const { id } = created.json<{ id: string }>()

        const listed = await server.inject({ method: 'GET', url: '/credentials' })
        expect(listed.json()).toMatchObject({ credentials: [{ id, kind: 'opencode-go', email: 'me@example.com' }] })
        expect(listed.body).not.toContain('sk-never-returned')

        expect((await server.inject({ method: 'DELETE', url: `/credentials/${id}` })).statusCode).toBe(204)
        const again = await server.inject({ method: 'DELETE', url: `/credentials/${id}` })
        expect(again.statusCode).toBe(404)
        expect(again.json()).toMatchObject({ error: { code: 'CREDENTIAL_NOT_FOUND' } })
      } finally {
        await server.close()
      }
    })

    it('takes a provider key without an email, and names the field an MCP key is missing', async () => {
      const server = await serve()
      try {
        // The account email is optional on a provider key; only an MCP key must name its server.
        const noEmail = await server.inject({
          method: 'POST',
          url: '/credentials',
          payload: { kind: 'opencode-go', name: 'work', value: 'sk-1' },
        })
        expect(noEmail.statusCode).toBe(201)
        expect(noEmail.json()).toMatchObject({ email: null })

        const noServer = await server.inject({
          method: 'POST',
          url: '/credentials',
          payload: { kind: 'mcp', name: 'github', value: 'ghp-1' },
        })
        expect(noServer.statusCode).toBe(400)
        expect(noServer.json()).toMatchObject({ error: { code: 'CREDENTIAL_MCP_REQUIRED' } })
      } finally {
        await server.close()
      }
    })
  })
}
