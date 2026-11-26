import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import type { Agent, ArchiveQuery, ThreadQuery } from './agent.js'
import type { Actor } from './auth/actor.js'
import { ALL_PERMISSIONS } from './auth/permissions.js'
import type { AuthService } from './auth/service.js'
import type { CapabilityApi } from './capabilities/api.js'
import type { AgentProfile } from './agents/agent-repository.js'
import type { EnvironmentApi } from './environments/api.js'
import type { DevEnvironment } from './environments/environment-repository.js'
import { loadConfig } from './config.js'
import { AppError } from './errors.js'
import { buildServer } from './server.js'
import { LOCAL_USER_ID } from './threads/local-user.js'
import type { ChatThread } from './threads/thread-repository.js'
import type { Workspace } from './workspaces/workspace-repository.js'

// The server is built from a validated Config, so the URL only has to parse; no connection is opened in these tests.
const DATABASE_URL = 'postgres://test:test@localhost:5432/cake_test'
const PRODUCTION_DATABASE_URL = 'postgres://app:app@db.internal:5432/cake'
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL, SECRET_KEY: 'a-test-secret-key' })

const THREAD_ID = '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f'
const WORKSPACE_ID = '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e'
const AGENT_ID = '4c3d2e5f-6a7b-4c9d-8e1f-2a3b4c5d6e7f'
const SUBMISSION_ID = 'sub_01'
const ENVIRONMENT_ID = '5d4e3f60-7b8c-4d1e-9f2a-3b4c5d6e7f80'

// Every field is spelled out once, so a test that cares about one of them overrides just that one.
const workspaceOf = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: WORKSPACE_ID,
  name: 'General',
  description: '',
  isDefault: true,
  allowAll: true,
  archivedAt: null,
  position: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

const agentOf = (overrides: Partial<AgentProfile> = {}): AgentProfile => ({
  id: AGENT_ID,
  workspaceId: WORKSPACE_ID,
  name: 'General',
  description: '',
  isDefault: true,
  allowAll: true,
  systemPromptAppend: '',
  instructions: '',
  credentialId: null,
  modelId: null,
  thinkingLevel: 'low',
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

const threadOf = (overrides: Partial<ChatThread> = {}): ChatThread => ({
  id: THREAD_ID,
  title: 'First',
  workspaceId: WORKSPACE_ID,
  agentId: AGENT_ID,
  durableConversationId: 1,
  overrides: { credentialId: null, modelId: null, thinkingLevel: null },
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

const unused = async (): Promise<never> => {
  throw new Error('the capability API is not part of this suite')
}

const environmentOf = (overrides: Partial<DevEnvironment> = {}): DevEnvironment => ({
  id: ENVIRONMENT_ID,
  name: 'Node',
  image: 'ghcr.io/tctcl/cake-harness/workspace:1.0.0',
  containerId: null,
  sshPort: 22_000,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

// Registration needs every member; a test overrides the one it exercises and the rest stay absent.
const environmentsOf = (overrides: Partial<EnvironmentApi> = {}): EnvironmentApi => ({
  followLogs: async () => undefined,
  // Containers authenticate with their bootstrap token; these tests present this one.
  acceptsBootstrapToken: (_id, presented) => presented === 'container-token',
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
  status: async () => 'missing',
  metrics: async () => null,
  ssh: async () => undefined,
  ports: async () => null,
  ...overrides,
})

// The workspace routes never read the catalog, so the stub answers only what registration needs.
const capabilitiesOf = (): CapabilityApi => ({
  tools: { list: async () => [] },
  skills: {
    list: async () => [],
    find: unused,
    create: unused,
    update: unused,
    archive: unused,
    restore: unused,
    remove: unused,
  },
  servers: {
    list: async () => [],
    find: unused,
    create: unused,
    update: unused,
    archive: unused,
    restore: unused,
    remove: unused,
  },
  workspaceGrants: unused,
  setWorkspaceGrants: unused,
  agentGrants: unused,
  setAgentGrants: unused,
})

const actorOf = (overrides: Partial<Actor> = {}): Actor => ({
  id: LOCAL_USER_ID,
  displayName: 'Local user',
  username: null,
  permissions: new Set(ALL_PERMISSIONS),
  pending: null,
  sessionId: null,
  singleUser: true,
  ...overrides,
})

/** Only the calls the actor plugin and the settings routes make: a test that needs another route stubs that instead. */
const authOf = (overrides: Partial<AuthService> = {}): AuthService =>
  ({
    resolve: async () => actorOf(),
    currentSettings: async () => ({ singleUser: true, requireTwoFactor: false }),
    ...overrides,
  }) as unknown as AuthService

function stubAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    auth: authOf(),
    capabilities: capabilitiesOf(),
    environments: environmentsOf(),
    // Only the credential routes read a key; a test that needs another store stubs that one instead.
    credentials: { list: async () => [], create: unused, remove: unused },
    sshKeys: { list: async () => [], upload: unused, generate: unused, remove: unused },
    answerQuestion: async () => 'not-found',
    // Same rule for the provider routes: the stub answers only what registration needs.
    providers: {
      logins: async () => [],
      models: async () => [],
      workspaceProviders: unused,
      setWorkspaceProviders: unused,
      usage: unused,
    },
    updateStatus: () => ({
      channel: 'production',
      current: null,
      latest: null,
      url: null,
      available: null,
      checkedAt: null,
      error: null,
    }),
    checkForUpdates: async () => ({
      channel: 'production',
      current: null,
      latest: null,
      url: null,
      available: null,
      checkedAt: null,
      error: null,
    }),
    workspaces: async () => [],
    workspace: async () => undefined,
    createWorkspace: async (input) => workspaceOf({ name: input.name, isDefault: false }),
    reorderWorkspaces: async () => [],
    updateWorkspace: async () => undefined,
    archiveWorkspace: async () => undefined,
    restoreWorkspace: async () => undefined,
    deleteWorkspace: async () => false,
    agents: async () => [],
    createAgent: async (workspaceId, input) => agentOf({ workspaceId, name: input.name }),
    updateAgent: async () => undefined,
    archiveAgent: async () => undefined,
    restoreAgent: async () => undefined,
    deleteAgent: async () => false,
    threads: async () => [],
    thread: async () => undefined,
    archiveThread: async () => undefined,
    restoreThread: async () => undefined,
    createThread: async (input) => ({
      id: THREAD_ID,
      title: input.title,
      workspaceId: input.workspaceId ?? WORKSPACE_ID,
      agentId: input.agentId ?? AGENT_ID,
      durableConversationId: 1,
      overrides: { credentialId: null, modelId: null, thinkingLevel: null },
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
    messages: async () => ({ messages: [], nextCursor: null }),
    toolCallDetails: async () => undefined,
    contextUsage: async () => ({
      provider: null,
      modelId: null,
      contextWindow: null,
      used: 0,
      remaining: null,
      categories: [],
    }),
    renameThread: async () => undefined,
    updateThreadRunSettings: async () => undefined,
    submit: async () => SUBMISSION_ID,
    watch: async () => async () => {},
    close: async () => {},
    ...overrides,
  }
}

const agent = stubAgent()

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

describe('GET /me', () => {
  it('answers with the identity the session resolved to', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({ method: 'GET', url: '/me' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        id: LOCAL_USER_ID,
        name: 'Local user',
        username: null,
        pending: null,
        singleUser: true,
      })

    } finally {
      await server.close()
    }
  })

  it('asks for a session once the install has accounts', async () => {
    const unauthenticated = stubAgent({ auth: authOf({ resolve: async () => undefined }) })
    const server = buildServer(config, { agent: unauthenticated })

    try {
      const response = await server.inject({ method: 'GET', url: '/me' })

      expect(response.statusCode).toBe(401)
      expect(response.json()).toEqual({
        error: { code: 'auth.unauthenticated', message: 'Sign in to continue.' },
      })
    } finally {
      await server.close()
    }
  })
})

describe('account SSH keys', () => {
  it('uses the signed-in account guard and returns public key metadata only', async () => {
    const publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHJPOdiu8Ol2WKBKTzIV+JvRpeQbODlBw8uQpa+7VXVs'
    const server = buildServer(config, {
      agent: stubAgent({
        sshKeys: {
          list: async () => [{
            id: 'key-1',
            name: 'Laptop',
            publicKey,
            fingerprint: 'SHA256:fingerprint',
            createdAt: new Date(0).toISOString(),
          }],
          upload: unused,
          generate: unused,
          remove: unused,
        },
        auth: authOf({
          resolve: async () => actorOf({ pending: 'password' }),
        }),
      }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: '/account/ssh-keys' })

      expect(response.statusCode).toBe(401)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('auth.pending')
    } finally {
      await server.close()
    }

    const signedIn = buildServer(config, {
      agent: stubAgent({
        sshKeys: {
          list: async () => [{
            id: 'key-1',
            name: 'Laptop',
            publicKey,
            fingerprint: 'SHA256:fingerprint',
            createdAt: new Date(0).toISOString(),
          }],
          upload: unused,
          generate: unused,
          remove: unused,
        },
      }),
    })

    try {
      const response = await signedIn.inject({ method: 'GET', url: '/account/ssh-keys' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        keys: [{
          id: 'key-1',
          name: 'Laptop',
          publicKey,
          fingerprint: 'SHA256:fingerprint',
          createdAt: new Date(0).toISOString(),
        }],
      })
      expect(response.body).not.toContain('PRIVATE KEY')
    } finally {
      await signedIn.close()
    }
  })
})

describe('error handling', () => {
  it('refuses to become ready when route registration fails', async () => {
    // Registration reads the auth service first; a throwing getter stands in for any failure during registration.
    const broken = {
      get auth(): never {
        throw new Error('registration broke')
      },
    } as unknown as Agent
    const server = buildServer(config, { agent: broken })

    try {
      await expect(server.ready()).rejects.toThrow('registration broke')
    } finally {
      await server.close()
    }
  })

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
    const productionServer = buildServer(
      loadConfig({
        NODE_ENV: 'production',
        LOG_LEVEL: 'silent',
        DATABASE_URL: PRODUCTION_DATABASE_URL,
        SECRET_KEY: 'a-production-secret',
      }),
      { agent },
    )
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

describe('thread routes', () => {
  it('lists the threads the agent knows', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        threads: async () => [
          {
            id: THREAD_ID,
            title: 'First',
            workspaceId: WORKSPACE_ID,
            agentId: AGENT_ID,
            durableConversationId: 4,
            overrides: { credentialId: null, modelId: null, thinkingLevel: null },
            archivedAt: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
      }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: '/threads' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        threads: [
          {
            id: THREAD_ID,
            title: 'First',
            workspaceId: WORKSPACE_ID,
            agentId: AGENT_ID,
            overrides: { credentialId: null, modelId: null, thinkingLevel: null },
            archivedAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('creates a thread and answers 201', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({
        method: 'POST',
        url: '/threads',
        payload: { title: 'Second' },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json<{ id: string; title: string }>().title).toBe('Second')
    } finally {
      await server.close()
    }
  })

  it('accepts a message and answers with the submission to follow', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({
        method: 'POST',
        url: `/threads/${THREAD_ID}/messages`,
        payload: { message: 'hello' },
      })

      expect(response.statusCode).toBe(202)
      expect(response.json()).toEqual({ submissionId: SUBMISSION_ID })
    } finally {
      await server.close()
    }
  })

  it('reads a page of the transcript and passes the cursor through', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        messages: async (_threadId, query) => ({
          messages: [
            {
              id: 7,
              role: 'assistant',
              text: `limit ${query.limit}`,
              blocks: [{ type: 'text', text: `limit ${query.limit}` }],
              stopReason: 'stop',
              errorMessage: null,
              reason: null,
            },
          ],
          nextCursor: query.cursor ?? 'first-page',
        }),
      }),
    })

    try {
      const response = await server.inject({
        method: 'GET',
        url: `/threads/${THREAD_ID}/messages?limit=7&cursor=next`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        messages: [
          {
            id: 7,
            role: 'assistant',
            text: 'limit 7',
            blocks: [{ type: 'text', text: 'limit 7' }],
            stopReason: 'stop',
            errorMessage: null,
            reason: null,
          },
        ],
        nextCursor: 'next',
      })
    } finally {
      await server.close()
    }
  })

  it('reports what the next request would carry, split by category', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        contextUsage: async () => ({
          provider: 'opencode-go',
          modelId: 'deepseek-v4.1-flash',
          contextWindow: 1000,
          used: 250,
          remaining: 750,
          categories: [
            { kind: 'messages', tokens: 100 },
            { kind: 'systemPrompt', tokens: 140 },
            { kind: 'systemTools', tokens: 10 },
          ],
        }),
      }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: `/threads/${THREAD_ID}/context` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        provider: 'opencode-go',
        modelId: 'deepseek-v4.1-flash',
        contextWindow: 1000,
        used: 250,
        remaining: 750,
        categories: [
          { kind: 'messages', tokens: 100 },
          { kind: 'systemPrompt', tokens: 140 },
          { kind: 'systemTools', tokens: 10 },
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('rules out an empty title and an empty message', async () => {
    const server = buildServer(config, { agent })

    try {
      const emptyTitle = await server.inject({ method: 'POST', url: '/threads', payload: { title: '' } })
      expect(emptyTitle.statusCode).toBe(400)

      const emptyMessage = await server.inject({
        method: 'POST',
        url: `/threads/${THREAD_ID}/messages`,
        payload: { message: '' },
      })
      expect(emptyMessage.statusCode).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('rules out a thread id that cannot be a uuid', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({ method: 'GET', url: '/threads/not-a-uuid/messages' })

      expect(response.statusCode).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('reports a missing thread as a structured 404', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        submit: async () => {
          throw new AppError('the thread does not exist', {
            statusCode: 404,
            code: 'THREAD_NOT_FOUND',
          })
        },
      }),
    })

    try {
      const response = await server.inject({
        method: 'POST',
        url: `/threads/${THREAD_ID}/messages`,
        payload: { message: 'hello' },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({
        error: { code: 'THREAD_NOT_FOUND', message: 'the thread does not exist' },
      })
    } finally {
      await server.close()
    }
  })

  it('forwards the archived flag to the thread listing', async () => {
    let seen: ThreadQuery | undefined
    const server = buildServer(config, {
      agent: stubAgent({
        threads: async (query) => {
          seen = query

          return []
        },
      }),
    })

    try {
      await server.inject({ method: 'GET', url: '/threads?archived=true' })

      expect(seen).toEqual({ workspaceId: undefined, archived: true })
    } finally {
      await server.close()
    }
  })

  it('archives a thread and reports its stamp', async () => {
    const stamped = new Date('2026-02-01T00:00:00.000Z')
    const server = buildServer(config, {
      agent: stubAgent({ archiveThread: async () => threadOf({ archivedAt: stamped }) }),
    })

    try {
      const response = await server.inject({
        method: 'POST',
        url: `/threads/${THREAD_ID}/archive`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json<{ archivedAt: string }>().archivedAt).toBe(stamped.toISOString())
    } finally {
      await server.close()
    }
  })

  it('answers 404 when archiving or restoring an unknown thread', async () => {
    const server = buildServer(config, { agent })

    try {
      const archived = await server.inject({
        method: 'POST',
        url: `/threads/${THREAD_ID}/archive`,
      })
      expect(archived.statusCode).toBe(404)
      expect(archived.json<{ error: { code: string } }>().error.code).toBe('THREAD_NOT_FOUND')

      const restored = await server.inject({
        method: 'POST',
        url: `/threads/${THREAD_ID}/restore`,
      })
      expect(restored.statusCode).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('reports an archived thread as a conflict when a message arrives', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        submit: async () => {
          throw new AppError('the thread is archived', {
            statusCode: 409,
            code: 'THREAD_ARCHIVED',
          })
        },
      }),
    })

    try {
      const response = await server.inject({
        method: 'POST',
        url: `/threads/${THREAD_ID}/messages`,
        payload: { message: 'hello' },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('THREAD_ARCHIVED')
    } finally {
      await server.close()
    }
  })
})

describe('workspace routes', () => {
  it('lists workspaces with their capabilities', async () => {
    const server = buildServer(config, {
      agent: stubAgent({ workspaces: async () => [workspaceOf()] }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: '/workspaces' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        workspaces: [
          {
            id: WORKSPACE_ID,
            name: 'General',
            description: '',
            isDefault: true,
            allowAll: true,
            archivedAt: null,
            position: 0,
            createdAt: '1970-01-01T00:00:00.000Z',
            updatedAt: '1970-01-01T00:00:00.000Z',
          },
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('rewrites the list order from the ids it is given', async () => {
    const asked: string[][] = []
    const server = buildServer(config, {
      agent: stubAgent({
        reorderWorkspaces: async (ids) => {
          asked.push([...ids])

          return ids.map((id, index) => workspaceOf({ id, isDefault: index === 0, position: index }))
        },
      }),
    })

    try {
      const response = await server.inject({
        method: 'PUT',
        url: '/workspaces/order',
        payload: { order: [AGENT_ID, WORKSPACE_ID] },
      })

      expect(response.statusCode).toBe(200)
      expect(asked).toEqual([[AGENT_ID, WORKSPACE_ID]])
      expect(response.json<{ workspaces: { id: string; position: number }[] }>().workspaces).toMatchObject([
        { id: AGENT_ID, position: 0 },
        { id: WORKSPACE_ID, position: 1 },
      ])
    } finally {
      await server.close()
    }
  })

  it('rules out an order with a repeated id or one that is not an id at all', async () => {
    const server = buildServer(config, { agent: stubAgent() })

    try {
      const repeated = await server.inject({
        method: 'PUT',
        url: '/workspaces/order',
        payload: { order: [WORKSPACE_ID, WORKSPACE_ID] },
      })
      expect(repeated.statusCode).toBe(400)

      const malformed = await server.inject({
        method: 'PUT',
        url: '/workspaces/order',
        payload: { order: ['not-a-workspace'] },
      })
      expect(malformed.statusCode).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('creates a workspace and rules out one without a name', async () => {
    const server = buildServer(config, { agent })

    try {
      const created = await server.inject({
        method: 'POST',
        url: '/workspaces',
        payload: { name: 'Platform', container: { image: 'devcontainer/node-26' } },
      })
      expect(created.statusCode).toBe(201)
      expect(created.json<{ name: string; isDefault: boolean }>()).toMatchObject({
        name: 'Platform',
        isDefault: false,
      })

      const unnamed = await server.inject({ method: 'POST', url: '/workspaces', payload: {} })
      expect(unnamed.statusCode).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('reports the default workspace as immutable', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        updateWorkspace: async () => {
          throw new AppError('the default workspace cannot be edited or deleted', {
            statusCode: 403,
            code: 'WORKSPACE_IMMUTABLE',
          })
        },
      }),
    })

    try {
      const response = await server.inject({
        method: 'PATCH',
        url: `/workspaces/${WORKSPACE_ID}`,
        payload: { name: 'Renamed' },
      })

      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({
        error: {
          code: 'WORKSPACE_IMMUTABLE',
          message: 'the default workspace cannot be edited or deleted',
        },
      })
    } finally {
      await server.close()
    }
  })

  it('answers 404 when deleting an unknown workspace', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({
        method: 'DELETE',
        url: `/workspaces/${WORKSPACE_ID}`,
      })

      expect(response.statusCode).toBe(404)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('WORKSPACE_NOT_FOUND')
    } finally {
      await server.close()
    }
  })

  it('rules out an id that cannot be a uuid', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({ method: 'GET', url: '/workspaces/not-a-uuid/agents' })

      expect(response.statusCode).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('lists the agents of a workspace', async () => {
    const server = buildServer(config, {
      agent: stubAgent({ agents: async () => [agentOf()] }),
    })

    try {
      const response = await server.inject({
        method: 'GET',
        url: `/workspaces/${WORKSPACE_ID}/agents`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json<{ agents: { id: string; isDefault: boolean }[] }>().agents).toHaveLength(1)
      expect(response.json()).toMatchObject({ agents: [{ id: AGENT_ID, isDefault: true }] })
    } finally {
      await server.close()
    }
  })

  it('creates an agent and reports a capability outside the ceiling', async () => {
    const server = buildServer(config, { agent })

    try {
      const created = await server.inject({
        method: 'POST',
        url: `/workspaces/${WORKSPACE_ID}/agents`,
        payload: { name: 'Reviewer', tools: ['read'] },
      })
      expect(created.statusCode).toBe(201)
      expect(created.json<{ name: string; workspaceId: string }>()).toMatchObject({
        name: 'Reviewer',
        workspaceId: WORKSPACE_ID,
      })
    } finally {
      await server.close()
    }

    const refusing = buildServer(config, {
      agent: stubAgent({
        createAgent: async () => {
          throw new AppError('the workspace does not allow: bash', {
            statusCode: 400,
            code: 'CAPABILITY_NOT_ALLOWED',
          })
        },
      }),
    })

    try {
      const denied = await refusing.inject({
        method: 'POST',
        url: `/workspaces/${WORKSPACE_ID}/agents`,
        payload: { name: 'Editor', tools: ['bash'] },
      })

      expect(denied.statusCode).toBe(400)
      expect(denied.json()).toEqual({
        error: { code: 'CAPABILITY_NOT_ALLOWED', message: 'the workspace does not allow: bash' },
      })
    } finally {
      await refusing.close()
    }
  })
  it('forwards the archived flag to the workspace listing', async () => {
    let seen: ArchiveQuery | undefined
    const server = buildServer(config, {
      agent: stubAgent({
        workspaces: async (query) => {
          seen = query

          return []
        },
      }),
    })

    try {
      await server.inject({ method: 'GET', url: '/workspaces?archived=true' })

      expect(seen).toEqual({ archived: true })
    } finally {
      await server.close()
    }
  })

  it('archives a workspace and reports its stamp', async () => {
    const stamped = new Date('2026-02-01T00:00:00.000Z')
    const server = buildServer(config, {
      agent: stubAgent({
        archiveWorkspace: async () => workspaceOf({ isDefault: false, archivedAt: stamped }),
      }),
    })

    try {
      const archived = await server.inject({
        method: 'POST',
        url: `/workspaces/${WORKSPACE_ID}/archive`,
      })
      expect(archived.statusCode).toBe(200)
      expect(archived.json<{ archivedAt: string }>().archivedAt).toBe(stamped.toISOString())

      const restored = await server.inject({
        method: 'POST',
        url: `/workspaces/${WORKSPACE_ID}/restore`,
      })
      expect(restored.statusCode).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('reports an archived workspace as a conflict when an agent is added', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        createAgent: async () => {
          throw new AppError('the workspace is archived', {
            statusCode: 409,
            code: 'WORKSPACE_ARCHIVED',
          })
        },
      }),
    })

    try {
      const response = await server.inject({
        method: 'POST',
        url: `/workspaces/${WORKSPACE_ID}/agents`,
        payload: { name: 'Reviewer' },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('WORKSPACE_ARCHIVED')
    } finally {
      await server.close()
    }
  })
})

describe('static frontend', () => {
  // The image puts the Vite build in FRONTEND_DIR; the test answers the same three requests the browser makes.
  const root = mkdtempSync(join(tmpdir(), 'cake-frontend-'))
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>')
  const frontendConfig = loadConfig({ NODE_ENV: 'test', DATABASE_URL, FRONTEND_DIR: root })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('serves index.html at the root', async () => {
    const server = buildServer(frontendConfig, { agent: stubAgent() })

    try {
      const response = await server.inject({ method: 'GET', url: '/' })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.body).toContain('<title>app</title>')
    } finally {
      await server.close()
    }
  })

  it('answers a browser navigation that matches no route with the same document', async () => {
    const server = buildServer(frontendConfig, { agent: stubAgent() })

    try {
      const response = await server.inject({
        method: 'GET',
        url: '/workspaces/some/deep/route',
        headers: { accept: 'text/html,application/xhtml+xml' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('<title>app</title>')
    } finally {
      await server.close()
    }
  })

  it('serves the app and the health check to a browser that is not signed in, and nothing else', async () => {
    mkdirSync(join(root, 'assets'), { recursive: true })
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log("app")')
    const server = buildServer(frontendConfig, {
      agent: stubAgent({ auth: authOf({ resolve: async () => undefined }) }),
    })

    try {
      const html = { accept: 'text/html' }
      expect((await server.inject({ method: 'GET', url: '/', headers: html })).statusCode).toBe(200)
      expect((await server.inject({ method: 'GET', url: '/assets/app.js' })).statusCode).toBe(200)
      expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
      // A reload on a deep path still gets the document; the API behind it still wants a session.
      expect((await server.inject({ method: 'GET', url: '/some/view', headers: html })).statusCode).toBe(200)
      expect((await server.inject({ method: 'GET', url: '/workspaces' })).statusCode).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('keeps the JSON shape for an unknown API path', async () => {
    const server = buildServer(frontendConfig, { agent: stubAgent() })

    try {
      const response = await server.inject({
        method: 'GET',
        url: '/no/such/endpoint',
        headers: { accept: 'application/json' },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND')
    } finally {
      await server.close()
    }
  })
})

describe('capability grant routes', () => {
  it('does not register the removed prompt catalog or manual tool sync', async () => {
    const server = buildServer(config, { agent: stubAgent() })

    try {
      expect((await server.inject({ method: 'GET', url: '/prompts' })).statusCode).toBe(404)
      expect((await server.inject({ method: 'POST', url: '/tools/sync' })).statusCode).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('answers a workspace s grants, which carry no MCP servers because the workspace owns them', async () => {
    const grants = { allowAll: false, grants: { skills: ['s1'] } }
    const server = buildServer(config, {
      agent: stubAgent({ capabilities: { ...capabilitiesOf(), workspaceGrants: async () => grants } }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: `/workspaces/${WORKSPACE_ID}/grants` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(grants)
    } finally {
      await server.close()
    }
  })
})

describe('environment routes', () => {
  it('lists environments with ISO timestamps', async () => {
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ list: async () => [environmentOf()] }) }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: '/environments' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        environments: [
          {
            id: ENVIRONMENT_ID,
            name: 'Node',
            image: 'ghcr.io/tctcl/cake-harness/workspace:1.0.0',
            containerId: null,
            sshPort: 22_000,
            createdAt: '1970-01-01T00:00:00.000Z',
            updatedAt: '1970-01-01T00:00:00.000Z',
          },
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('answers 404 for an unknown environment', async () => {
    const server = buildServer(config, { agent: stubAgent() })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}` })

      expect(response.statusCode).toBe(404)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('ENVIRONMENT_NOT_FOUND')
    } finally {
      await server.close()
    }
  })

  it('answers what Docker says the container is doing, which the row alone cannot', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        environments: environmentsOf({
          find: async () => environmentOf({ containerId: 'abc123' }),
          status: async () => 'stopped',
        }),
      }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}` })

      expect(response.statusCode).toBe(200)
      expect(response.json<{ status: string }>().status).toBe('stopped')
    } finally {
      await server.close()
    }
  })

  it('reports live usage of a running environment in bytes', async () => {
    const metrics = {
      cpuPercent: 12.5,
      memoryUsedBytes: 1024,
      memoryLimitBytes: 4096,
      networkReceiveBytes: 1,
      networkTransmitBytes: 2,
      blockReadBytes: 3,
      blockWriteBytes: 4,
    }
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ metrics: async () => metrics }) }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/metrics` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(metrics)
    } finally {
      await server.close()
    }
  })

  it('answers 409 rather than zeros for a stopped environment', async () => {
    const server = buildServer(config, { agent: stubAgent() })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/metrics` })

      expect(response.statusCode).toBe(409)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('ENVIRONMENT_STOPPED')
    } finally {
      await server.close()
    }
  })

  it('answers 404 for the metrics of an unknown environment', async () => {
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ metrics: async () => undefined }) }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/metrics` })

      expect(response.statusCode).toBe(404)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('ENVIRONMENT_NOT_FOUND')
    } finally {
      await server.close()
    }
  })

  it('answers the stable SSH endpoint with running false for a stopped container', async () => {
    const access = {
      command: 'ssh -p 22000 dev@dev.example',
      host: 'dev.example',
      port: 22_000,
      user: 'dev',
      running: false,
    }
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ ssh: async () => access }) }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/ssh` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(access)
    } finally {
      await server.close()
    }
  })

  it('answers the SSH command when a port is published', async () => {
    const access = { command: 'ssh -p 2222 dev@127.0.0.1', host: '127.0.0.1', port: 2222, user: 'dev', running: true }
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ ssh: async () => access }) }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/ssh` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(access)
    } finally {
      await server.close()
    }
  })

  it('answers 404 for the SSH access of an unknown environment', async () => {
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ ssh: async () => undefined }) }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/ssh` })

      expect(response.statusCode).toBe(404)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('ENVIRONMENT_NOT_FOUND')
    } finally {
      await server.close()
    }
  })

  it('answers the listening ports with workspace SSH forwarding commands', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        environments: environmentsOf({
          find: async () => environmentOf(),
          ports: async () => [5173, 8080],
        }),
      }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/ports` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        ports: [
          { port: 5173, command: 'ssh -N -L 5173:localhost:5173 cake-node' },
          { port: 8080, command: 'ssh -N -L 8080:localhost:8080 cake-node' },
        ],
      })
    } finally {
      await server.close()
    }
  })

  it('records the container a start produced', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        environments: environmentsOf({ start: async () => environmentOf({ containerId: 'abc123' }) }),
      }),
    })

    try {
      const response = await server.inject({
        method: 'POST',
        url: `/environments/${ENVIRONMENT_ID}/start`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json<{ containerId: string }>().containerId).toBe('abc123')
    } finally {
      await server.close()
    }
  })

  it('refuses a malformed id before the lookup', async () => {
    const server = buildServer(config, { agent: stubAgent() })

    try {
      const response = await server.inject({ method: 'GET', url: '/environments/not-a-uuid' })

      expect(response.statusCode).toBe(400)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR')
    } finally {
      await server.close()
    }
  })

  it('scopes the workspace list and answers 404 for an unknown workspace', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        workspace: async (id) => (id === WORKSPACE_ID ? workspaceOf() : undefined),
      }),
    })

    try {
      const listed = await server.inject({ method: 'GET', url: `/workspaces/${WORKSPACE_ID}/environments` })
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual({ environments: [] })

      const missing = await server.inject({
        method: 'GET',
        url: '/workspaces/00000000-0000-4000-8000-00000000dead/environments',
      })
      expect(missing.statusCode).toBe(404)
      expect(missing.json<{ error: { code: string } }>().error.code).toBe('WORKSPACE_NOT_FOUND')
    } finally {
      await server.close()
    }
  })

  it('answers null for an agent without an environment', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        workspace: async (id) => (id === WORKSPACE_ID ? workspaceOf() : undefined),
        agents: async (workspaceId) => (workspaceId === WORKSPACE_ID ? [agentOf()] : []),
      }),
    })

    try {
      const response = await server.inject({
        method: 'GET',
        url: `/workspaces/${WORKSPACE_ID}/agents/${AGENT_ID}/environment`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ environment: null })
    } finally {
      await server.close()
    }
  })

  it('answers 404 for an agent outside the workspace', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        workspace: async () => workspaceOf(),
        agents: async () => [],
      }),
    })

    try {
      const response = await server.inject({
        method: 'GET',
        url: `/workspaces/${WORKSPACE_ID}/agents/${AGENT_ID}/environment`,
      })

      expect(response.statusCode).toBe(404)
      expect(response.json<{ error: { code: string } }>().error.code).toBe('AGENT_NOT_FOUND')
    } finally {
      await server.close()
    }
  })
  it('serves the documents a workspace bootstraps from', async () => {
    const manifest = {
      tooling: { schemaVersion: 1, tools: [{ id: 'node', version: '26.13.1' }] },
      credentials: { schemaVersion: 1, credentials: [] },
    } as const
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ manifest: async () => manifest }) }),
    })

    try {
      const response = await server.inject({
        method: 'GET',
        url: `/environments/${ENVIRONMENT_ID}/manifest`,
        headers: { authorization: 'Bearer container-token' },
      })

      expect(response.statusCode).toBe(200)
      // The whole document survives: no response schema strips a field the container needs.
      expect(response.json()).toEqual(manifest)
    } finally {
      await server.close()
    }
  })

  it('streams a container log as server-sent events and ends with the container', async () => {
    const followLogs = vi.fn(async (_id: string, follow: Parameters<EnvironmentApi['followLogs']>[1]) => {
      follow.onLine({ stream: 'stdout', at: '2026-11-26T00:00:00Z', text: 'bootstrap.start' })
      follow.onLine({ stream: 'stderr', at: null, text: 'Server listening on 0.0.0.0 port 22.' })
      // A stopped container's log ends right after its tail.
      follow.onEnd()
      return () => {}
    })
    const server = buildServer(config, { agent: stubAgent({ environments: environmentsOf({ followLogs }) }) })

    try {
      const response = await server.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/logs` })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/event-stream')
      expect(response.body).toContain(
        'event: line\ndata: {"stream":"stdout","at":"2026-11-26T00:00:00Z","text":"bootstrap.start"}\n\n',
      )
      expect(response.body).toContain('"stream":"stderr"')
      expect(response.body.trimEnd().endsWith('event: end\ndata: {}')).toBe(true)
      expect(followLogs).toHaveBeenCalledWith(ENVIRONMENT_ID, expect.objectContaining({ tail: 200 }))
    } finally {
      await server.close()
    }
  })

  it('answers 404 for the log of an unknown environment and 409 before a container exists', async () => {
    const unknown = buildServer(config, { agent: stubAgent({ environments: environmentsOf({ followLogs: async () => undefined }) }) })
    const uncreated = buildServer(config, { agent: stubAgent({ environments: environmentsOf({ followLogs: async () => null }) }) })

    try {
      expect((await unknown.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/logs` })).statusCode).toBe(404)
      expect((await uncreated.inject({ method: 'GET', url: `/environments/${ENVIRONMENT_ID}/logs` })).statusCode).toBe(409)
    } finally {
      await unknown.close()
      await uncreated.close()
    }
  })

  it('refuses the manifest and the state report without the container token', async () => {
    const manifest = vi.fn(async () => undefined)
    const recordState = vi.fn(async () => true)
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ manifest, recordState }) }),
    })

    try {
      for (const authorization of [undefined, 'Bearer wrong-token', 'container-token']) {
        const read = await server.inject({
          method: 'GET',
          url: `/environments/${ENVIRONMENT_ID}/manifest`,
          ...(authorization === undefined ? {} : { headers: { authorization } }),
        })
        expect(read.statusCode).toBe(401)
        expect(read.json<{ error: { code: string } }>().error.code).toBe('ENVIRONMENT_TOKEN_INVALID')

        const report = await server.inject({
          method: 'PUT',
          url: `/environments/${ENVIRONMENT_ID}/state`,
          ...(authorization === undefined ? {} : { headers: { authorization } }),
          payload: { schemaVersion: 1, reportedAt: '2026-01-01T00:00:00.000Z', tools: [] },
        })
        expect(report.statusCode).toBe(401)
      }
      expect(manifest).not.toHaveBeenCalled()
      expect(recordState).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('answers 404 for a manifest of an unknown environment', async () => {
    const server = buildServer(config, { agent: stubAgent() })

    try {
      const response = await server.inject({
        method: 'GET',
        url: `/environments/${ENVIRONMENT_ID}/manifest`,
        headers: { authorization: 'Bearer container-token' },
      })

      expect(response.statusCode).toBe(404)
    } finally {
      await server.close()
    }
  })

  it('stores the report a container sends', async () => {
    const recordState = vi.fn(async () => true)
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ recordState }) }),
    })
    const state = {
      schemaVersion: 1,
      reportedAt: '2026-01-01T00:00:00.000Z',
      tools: [{ id: 'node', version: '26.13.1', path: '/opt/node/bin/node', source: 'installed' }],
    }

    try {
      const response = await server.inject({
        method: 'PUT',
        url: `/environments/${ENVIRONMENT_ID}/state`,
        headers: { authorization: 'Bearer container-token' },
        payload: state,
      })

      expect(response.statusCode).toBe(204)
      expect(recordState).toHaveBeenCalledWith(ENVIRONMENT_ID, state)
    } finally {
      await server.close()
    }
  })

  it('rules out a report the contract does not allow', async () => {
    const recordState = vi.fn(async () => true)
    const server = buildServer(config, {
      agent: stubAgent({ environments: environmentsOf({ recordState }) }),
    })

    try {
      const response = await server.inject({
        method: 'PUT',
        url: `/environments/${ENVIRONMENT_ID}/state`,
        headers: { authorization: 'Bearer container-token' },
        payload: { schemaVersion: 1, reportedAt: 'yesterday' },
      })

      expect(response.statusCode).toBe(400)
      expect(recordState).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('answers null for an environment that has never reported', async () => {
    const server = buildServer(config, {
      agent: stubAgent({
        environments: environmentsOf({
          find: async () => environmentOf(),
          state: async () => undefined,
        }),
      }),
    })

    try {
      const response = await server.inject({
        method: 'GET',
        url: `/environments/${ENVIRONMENT_ID}/state`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ reportedAt: null, state: null })
    } finally {
      await server.close()
    }
  })
})

describe('update routes', () => {
  const status = {
    channel: 'production',
    current: '0.2.0',
    latest: '0.3.0',
    url: 'https://github.com/Tctcl/cake-harness/releases/tag/v0.3.0',
    available: true,
    checkedAt: '2026-01-01T00:00:00.000Z',
    error: null,
  } as const

  it('reports the last check without asking GitHub', async () => {
    const checkForUpdates = vi.fn()
    const server = buildServer(config, {
      agent: stubAgent({ updateStatus: () => status, checkForUpdates }),
    })

    try {
      const response = await server.inject({ method: 'GET', url: '/updates' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(status)
      expect(checkForUpdates).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('forces a check on POST and answers with its result', async () => {
    const checked = { ...status, checkedAt: '2026-01-01T00:05:00.000Z' }
    const checkForUpdates = vi.fn(async () => checked)
    const server = buildServer(config, { agent: stubAgent({ checkForUpdates }) })

    try {
      const response = await server.inject({ method: 'POST', url: '/updates' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(checked)
      expect(checkForUpdates).toHaveBeenCalledOnce()
    } finally {
      await server.close()
    }
  })
})
