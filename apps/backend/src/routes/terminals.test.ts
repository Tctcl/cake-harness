import fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import type { EnvironmentApi } from '../environments/api.js'
import type { DevEnvironment } from '../environments/environment-repository.js'
import { registerErrorHandling } from '../error-handler.js'
import type { Pty, PtyExit, PtyFactory } from '../terminal/pty.js'
import { TerminalSessions } from '../terminal/sessions.js'
import type { TerminalSize } from '../terminal/contract.js'
import { terminalRoutes } from './terminals.js'

const WORKSPACE_ID = '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e'
const ENVIRONMENT_ID = '5d4e3f60-7b8c-4d1e-9f2a-3b4c5d6e7f80'
const OTHER_ENVIRONMENT_ID = '6e5f4071-8c9d-4e2f-8a3b-4c5d6e7f8091'
const TERMINAL_ID = '7f605182-9d0e-4f30-9b4c-5d6e7f809102'

class FakePty implements Pty {
  #exits: ((exit: PtyExit) => void)[] = []

  onData(): void {}

  onExit(listener: (exit: PtyExit) => void): void {
    this.#exits.push(listener)
  }

  write(): boolean {
    return true
  }

  resize(_size: TerminalSize): void {}

  async kill(): Promise<void> {
    for (const listener of this.#exits) listener({ code: 0, signal: null })
    this.#exits = []
  }
}

const ptys: PtyFactory = { open: async () => new FakePty() }

const environmentOf = (overrides: Partial<DevEnvironment> = {}): DevEnvironment => ({
  id: ENVIRONMENT_ID,
  name: 'Node',
  image: 'ghcr.io/tctcl/cake-harness/workspace:1.0.0',
  containerId: 'container-one',
  sshPort: 22_000,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

const environmentsOf = (overrides: Partial<EnvironmentApi> = {}): EnvironmentApi => ({
  acceptsBootstrapToken: () => false,
  list: async () => [],
  find: async () => undefined,
  create: async (name) => environmentOf({ name }),
  update: async () => undefined,
  remove: async () => false,
  start: async () => undefined,
  stop: async () => undefined,
  ofWorkspace: async () => [],
  workspacesOf: async () => [],
  ofAgent: async () => undefined,
  attach: async () => false,
  detach: async () => false,
  connectAgent: async () => {},
  disconnectAgent: async () => false,
  manifest: async () => undefined,
  recordState: async () => false,
  state: async () => undefined,
  status: async () => 'running',
  metrics: async () => null,
  ssh: async () => undefined,
  ports: async () => null,
  ...overrides,
})

interface Harness {
  readonly server: ReturnType<typeof fastify>
  readonly terminals: TerminalSessions
  readonly url: (suffix?: string) => string
  close(): Promise<void>
}

/** `null` means "no environment with that id": `undefined` would select the default parameter instead. */
const harnessOf = async (environment: DevEnvironment | null = environmentOf(), maxSessions = 2): Promise<Harness> => {
  const server = fastify()
  registerErrorHandling(server, { exposeDetails: true, sendIndex: undefined })

  const terminals = new TerminalSessions({
    ptys,
    limits: { maxSessions, scrollbackBytes: 1024, idleTimeoutMs: 0 },
    command: ['/bin/sh'],
  })
  const environments = environmentsOf({
    find: async (id) => (environment !== null && id === environment.id ? environment : undefined),
  })

  await server.register(terminalRoutes, { environments, terminals })
  await server.ready()

  return {
    server,
    terminals,
    url: (suffix = '') => `/workspaces/${WORKSPACE_ID}/environments/${ENVIRONMENT_ID}/terminals${suffix}`,
    close: async () => {
      await terminals.shutdown()
      await server.close()
    },
  }
}

describe('terminal routes', () => {
  it('lists the sessions of an environment, empty to begin with', async () => {
    const harness = await harnessOf()
    try {
      const response = await harness.server.inject({ method: 'GET', url: harness.url() })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ terminals: [] })
    } finally {
      await harness.close()
    }
  })

  it('creates a session and reports it with the environment it belongs to', async () => {
    const harness = await harnessOf()
    try {
      const response = await harness.server.inject({ method: 'POST', url: harness.url(), payload: {} })

      expect(response.statusCode).toBe(201)
      expect(response.json()).toMatchObject({
        environmentId: ENVIRONMENT_ID,
        label: 'Terminal 1',
        size: { cols: 80, rows: 24 },
        attached: false,
      })
    } finally {
      await harness.close()
    }
  })

  it('honours the size and label a client asks for', async () => {
    const harness = await harnessOf()
    try {
      const response = await harness.server.inject({
        method: 'POST',
        url: harness.url(),
        payload: { label: 'build', size: { cols: 120, rows: 40 } },
      })

      expect(response.json()).toMatchObject({ label: 'build', size: { cols: 120, rows: 40 } })
    } finally {
      await harness.close()
    }
  })

  it('answers 409 for a stopped environment instead of spawning one', async () => {
    const harness = await harnessOf(environmentOf({ containerId: null }))
    try {
      const response = await harness.server.inject({ method: 'POST', url: harness.url(), payload: {} })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({
        error: { code: 'ENVIRONMENT_STOPPED', message: 'start the environment before opening a terminal' },
      })
    } finally {
      await harness.close()
    }
  })

  it('answers 404 for an environment that does not exist', async () => {
    const harness = await harnessOf(null)
    try {
      const response = await harness.server.inject({ method: 'GET', url: harness.url() })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toMatchObject({ error: { code: 'ENVIRONMENT_NOT_FOUND' } })
    } finally {
      await harness.close()
    }
  })

  it('refuses more sessions than the cap allows', async () => {
    const harness = await harnessOf(environmentOf(), 1)
    try {
      await harness.server.inject({ method: 'POST', url: harness.url(), payload: {} })
      const response = await harness.server.inject({ method: 'POST', url: harness.url(), payload: {} })

      expect(response.statusCode).toBe(409)
      expect(response.json()).toMatchObject({ error: { code: 'TERMINAL_LIMIT_REACHED' } })
    } finally {
      await harness.close()
    }
  })

  it('closes a session and answers 204', async () => {
    const harness = await harnessOf()
    try {
      const created = await harness.server.inject({ method: 'POST', url: harness.url(), payload: {} })
      const { id } = created.json() as { id: string }

      const response = await harness.server.inject({ method: 'DELETE', url: harness.url(`/${id}`) })
      expect(response.statusCode).toBe(204)
      expect(harness.terminals.list(ENVIRONMENT_ID)).toEqual([])
    } finally {
      await harness.close()
    }
  })

  it('answers 404 for an unknown session and for one from another environment', async () => {
    const harness = await harnessOf()
    try {
      const unknown = await harness.server.inject({ method: 'DELETE', url: harness.url(`/${TERMINAL_ID}`) })
      expect(unknown.statusCode).toBe(404)

      await harness.server.inject({ method: 'POST', url: harness.url(), payload: {} })
      const { id } = harness.terminals.list(ENVIRONMENT_ID)[0] ?? { id: '' }
      const elsewhere = await harness.server.inject({
        method: 'DELETE',
        url: `/workspaces/${WORKSPACE_ID}/environments/${OTHER_ENVIRONMENT_ID}/terminals/${id}`,
      })

      expect(elsewhere.statusCode).toBe(404)
      expect(elsewhere.json()).toMatchObject({ error: { code: 'TERMINAL_NOT_FOUND' } })
    } finally {
      await harness.close()
    }
  })

  it('rejects a body that names a size outside the bounds', async () => {
    const harness = await harnessOf()
    try {
      const response = await harness.server.inject({
        method: 'POST',
        url: harness.url(),
        payload: { size: { cols: 5000, rows: 24 } },
      })

      expect(response.statusCode).toBe(400)
    } finally {
      await harness.close()
    }
  })
})
