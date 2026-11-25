import { afterAll, describe, expect, it } from 'vitest'

import type { Agent } from '../agent.js'
import { LOGIN_FAILURE_LIMIT } from '../auth/login-throttle.js'
import { AuthService } from '../auth/service.js'
import { DEFAULT_SETTINGS } from '../auth/settings-repository.js'
import { loadConfig } from '../config.js'
import { buildServer } from '../server.js'
import { createPool } from '../storage/postgres/db.js'
import { createSchema, migrate } from '../storage/postgres/schema.js'

/**
 * Sign-in end to end: the real AuthService over a real database behind the real routes. The rest of the agent is absent,
 * because nothing here reaches it; a route that did would fail loudly on the missing method.
 */
const url = process.env['DATABASE_URL']
const PASSWORD = 'correct horse battery staple'

if (url === undefined) {
  describe.skip('auth routes (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const pools: ReturnType<typeof createPool>[] = []

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()))
  })

  /** A fresh install per case: its own tables, migrated, the owner seeded and single-user mode on. */
  const install = async (environment: Record<string, string> = {}, now: () => number = Date.now) => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url, SECRET_KEY: 'a-test-secret-key', ...environment })
    const pool = createPool(url, { max: 2 })
    pools.push(pool)
    const schema = createSchema(`auth${run}_${caseIndex++}_`)
    await migrate(pool, schema)
    const auth = new AuthService({ pool, schema, secrets: config.secrets }, now)
    // The catalog routes look up their two text catalogs while registering; nothing here calls them.
    const agent = { auth, capabilities: { skills: {} } } as unknown as Agent
    const server = buildServer(config, { agent })

    return { auth, server, pool, schema, secrets: config.secrets }
  }

  const login = (server: ReturnType<typeof buildServer>, password: string, headers: Record<string, string> = {}) =>
    server.inject({ method: 'POST', url: '/auth/login', payload: { username: 'Admin', password }, headers })

  const sessionCookieOf = (setCookie: string | string[] | undefined): string => {
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie
    const pair = header?.split(';')[0]
    if (pair === undefined) throw new Error('no session cookie was set')

    return pair
  }

  describe('a fresh install', () => {
    it('is single-user: every request is the owner and there is nothing to sign in to', async () => {
      const { server } = await install()
      try {
        const session = await server.inject({ method: 'GET', url: '/auth/session' })
        expect(session.statusCode).toBe(200)
        expect(session.json()).toMatchObject({ singleUser: true, pending: null })

        expect((await login(server, PASSWORD)).statusCode).toBe(404)
      } finally {
        await server.close()
      }
    })

    it('serves the built-in system prompt and saves or resets an override through settings routes', async () => {
      const { server } = await install()
      try {
        const initial = await server.inject({ method: 'GET', url: '/settings' })
        expect(initial.statusCode).toBe(200)
        expect(initial.json()).toMatchObject({
          systemPrompt: DEFAULT_SETTINGS.systemPrompt,
          defaultSystemPrompt: DEFAULT_SETTINGS.systemPrompt,
        })

        const changed = await server.inject({
          method: 'PUT',
          url: '/settings',
          payload: { systemPrompt: 'Use the concise house style.' },
        })
        expect(changed.statusCode).toBe(200)
        expect(changed.json()).toMatchObject({
          systemPrompt: 'Use the concise house style.',
          defaultSystemPrompt: DEFAULT_SETTINGS.systemPrompt,
        })

        const reset = await server.inject({
          method: 'PUT',
          url: '/settings',
          payload: { systemPrompt: DEFAULT_SETTINGS.systemPrompt },
        })
        expect(reset.statusCode).toBe(200)
        expect(reset.json()).toMatchObject({
          systemPrompt: DEFAULT_SETTINGS.systemPrompt,
          defaultSystemPrompt: DEFAULT_SETTINGS.systemPrompt,
        })
      } finally {
        await server.close()
      }
    })
  })

  describe('bootstrapOwner', () => {
    it('turns accounts on with the owner as the admin, once', async () => {
      const { auth } = await install()

      await expect(auth.bootstrapOwner('Admin', PASSWORD)).resolves.toBe('created')
      // A second run must not reset a password the admin may have changed since.
      await expect(auth.bootstrapOwner('admin', 'another long password')).resolves.toBe('exists')

      const settings = await auth.settings.read()
      expect(settings.singleUser).toBe(false)
      const owner = await auth.users.findByUsername('admin')
      expect(owner).toMatchObject({ username: 'admin', grantsAll: true, mustChangePassword: false })
    })

    it('is noticed by a running server within seconds, though another process made it', async () => {
      let now = 0
      const { server, pool, schema, secrets } = await install({}, () => now)
      try {
        expect((await server.inject({ method: 'GET', url: '/auth/session' })).json()).toMatchObject({ singleUser: true })

        // What install.sh does: a separate process with its own AuthService turns accounts on.
        await new AuthService({ pool, schema, secrets }).bootstrapOwner('admin', PASSWORD)
        now += 10_000

        expect((await server.inject({ method: 'GET', url: '/auth/session' })).statusCode).toBe(401)
      } finally {
        await server.close()
      }
    })

    it('refuses a bad username or a short password and leaves single-user mode on', async () => {
      const { auth } = await install()

      await expect(auth.bootstrapOwner('x', PASSWORD)).rejects.toMatchObject({ code: 'auth.invalid_username' })
      await expect(auth.bootstrapOwner('admin', 'short')).rejects.toMatchObject({ code: 'auth.invalid_password' })
      expect((await auth.settings.read()).singleUser).toBe(true)
    })
  })

  describe('with accounts on', () => {
    const bootstrapped = async (environment: Record<string, string> = {}) => {
      const installed = await install(environment)
      await installed.auth.bootstrapOwner('admin', PASSWORD)

      return installed
    }

    it('answers 401 to everything but the public routes until signed in', async () => {
      const { server } = await bootstrapped()
      try {
        const workspaces = await server.inject({ method: 'GET', url: '/workspaces' })
        expect(workspaces.statusCode).toBe(401)
        expect(workspaces.json()).toMatchObject({ error: { code: 'auth.unauthenticated' } })

        const publicSettings = await server.inject({ method: 'GET', url: '/settings/public' })
        expect(publicSettings.json()).toEqual({ singleUser: false })
      } finally {
        await server.close()
      }
    })

    it('signs in with the right password, case-insensitively by username, and signs out again', async () => {
      const { server } = await bootstrapped()
      try {
        expect((await login(server, 'wrong password!!')).json()).toMatchObject({
          error: { code: 'auth.invalid_credentials' },
        })

        const signedIn = await login(server, PASSWORD)
        expect(signedIn.statusCode).toBe(200)
        expect(signedIn.json()).toMatchObject({ username: 'admin', pending: null, singleUser: false })
        const setCookie = signedIn.headers['set-cookie']
        expect(String(setCookie)).toContain('HttpOnly')
        expect(String(setCookie)).not.toContain('Secure')

        const cookie = sessionCookieOf(setCookie)
        const session = await server.inject({ method: 'GET', url: '/auth/session', headers: { cookie } })
        expect(session.json()).toMatchObject({ username: 'admin' })

        const logout = await server.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } })
        expect(logout.statusCode).toBe(204)
        expect((await server.inject({ method: 'GET', url: '/auth/session', headers: { cookie } })).statusCode).toBe(401)
      } finally {
        await server.close()
      }
    })

    it('marks the cookie Secure behind a TLS-terminating proxy when TRUST_PROXY is on', async () => {
      const { server } = await bootstrapped({ TRUST_PROXY: 'true' })
      try {
        const signedIn = await login(server, PASSWORD, { 'x-forwarded-proto': 'https' })
        expect(String(signedIn.headers['set-cookie'])).toContain('Secure')
      } finally {
        await server.close()
      }
    })

    it('stops answering after too many failures from one address, even with the right password', async () => {
      const { server } = await bootstrapped()
      try {
        for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
          expect((await login(server, 'wrong password!!')).statusCode).toBe(401)
        }

        const blocked = await login(server, PASSWORD)
        expect(blocked.statusCode).toBe(429)
        expect(blocked.headers['retry-after']).toBeDefined()
      } finally {
        await server.close()
      }
    })

    it('refuses a second account while ownership is not per user', async () => {
      const { server } = await bootstrapped()
      try {
        const cookie = sessionCookieOf((await login(server, PASSWORD)).headers['set-cookie'])
        const roles = (await server.inject({ method: 'GET', url: '/roles', headers: { cookie } })).json<
          { id: string; name: string }[]
        >()
        const member = roles.find((role) => role.name === 'member')

        const created = await server.inject({
          method: 'POST',
          url: '/users',
          headers: { cookie },
          payload: { username: 'second', roleId: member?.id ?? '' },
        })
        expect(created.statusCode).toBe(409)
        expect(created.json()).toMatchObject({ error: { code: 'auth.accounts_pending' } })
      } finally {
        await server.close()
      }
    })

    it('answers a too-short new password with 400, not a server error', async () => {
      const { server } = await bootstrapped()
      try {
        const cookie = sessionCookieOf((await login(server, PASSWORD)).headers['set-cookie'])
        const changed = await server.inject({
          method: 'POST',
          url: '/auth/password/change',
          headers: { cookie },
          payload: { current: PASSWORD, next: 'short' },
        })

        expect(changed.statusCode).toBe(400)
        expect(changed.json()).toMatchObject({ error: { code: 'auth.invalid_password' } })
      } finally {
        await server.close()
      }
    })
  })
}
