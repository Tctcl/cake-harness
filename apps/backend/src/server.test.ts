import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import type { Agent, ArchiveQuery, ThreadQuery } from './agent.js'
import type { CapabilityApi } from './capabilities/api.js'
import type { AgentProfile } from './agents/agent-repository.js'
import { loadConfig } from './config.js'
import { AppError } from './errors.js'
import { buildServer } from './server.js'
import { LOCAL_USER_ID } from './threads/local-user.js'
import type { ChatThread } from './threads/thread-repository.js'
import type { Workspace } from './workspaces/workspace-repository.js'

// The server is built from a validated Config, so the URL only has to parse; no connection is opened in these tests.
const DATABASE_URL = 'postgres://test:test@localhost:5432/tlabs_test'
const PRODUCTION_DATABASE_URL = 'postgres://app:app@db.internal:5432/tlabs'
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL })

const THREAD_ID = '2f1c1f9e-3f6d-4b0a-9d1e-1a2b3c4d5e6f'
const WORKSPACE_ID = '3b2c1d4e-5f6a-4b8c-9d0e-1f2a3b4c5d6e'
const AGENT_ID = '4c3d2e5f-6a7b-4c9d-8e1f-2a3b4c5d6e7f'
const SUBMISSION_ID = 'sub_01'

// Every field is spelled out once, so a test that cares about one of them overrides just that one.
const workspaceOf = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: WORKSPACE_ID,
  name: 'General',
  description: '',
  isDefault: true,
  allowAll: true,
  archivedAt: null,
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
  systemPrompt: '',
  instructions: '',
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
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

const unused = async (): Promise<never> => {
  throw new Error('the capability API is not part of this suite')
}

// The workspace routes never read the catalog, so the stub answers only what registration needs.
const capabilitiesOf = (): CapabilityApi => ({
  tools: { list: async () => [], sync: async () => [] },
  prompts: {
    list: async () => [],
    find: unused,
    create: unused,
    update: unused,
    archive: unused,
    restore: unused,
    remove: unused,
  },
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
  credentials: {
    list: async () => [],
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

function stubAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    capabilities: capabilitiesOf(),
    me: async () => ({ id: LOCAL_USER_ID, name: 'Local user' }),
    workspaces: async () => [],
    createWorkspace: async (input) => workspaceOf({ name: input.name, isDefault: false }),
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
    archiveThread: async () => undefined,
    restoreThread: async () => undefined,
    createThread: async (input) => ({
      id: THREAD_ID,
      title: input.title,
      workspaceId: input.workspaceId ?? WORKSPACE_ID,
      agentId: input.agentId ?? AGENT_ID,
      durableConversationId: 1,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
    messages: async () => ({ messages: [], nextCursor: null }),
    renameThread: async () => undefined,
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
  it('answers with the identity the sessions belong to', async () => {
    const server = buildServer(config, { agent })

    try {
      const response = await server.inject({ method: 'GET', url: '/me' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ id: LOCAL_USER_ID, name: 'Local user' })
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
    const productionServer = buildServer(
      loadConfig({ NODE_ENV: 'production', LOG_LEVEL: 'silent', DATABASE_URL: PRODUCTION_DATABASE_URL }),
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
          messages: [{ id: 7, role: 'assistant', text: `limit ${query.limit}` }],
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
        messages: [{ id: 7, role: 'assistant', text: 'limit 7' }],
        nextCursor: 'next',
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
            createdAt: '1970-01-01T00:00:00.000Z',
            updatedAt: '1970-01-01T00:00:00.000Z',
          },
        ],
      })
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
  const root = mkdtempSync(join(tmpdir(), 'tctcl-frontend-'))
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
