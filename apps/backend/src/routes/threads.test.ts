import { afterAll, describe, expect, it } from 'vitest'

import type { Agent } from '../agent.js'
import { AgentRepository } from '../agents/agent-repository.js'
import { DEFAULT_MODEL_ID } from '../agents/run-settings.js'
import type { WorkspaceReach } from '../agents/run-settings.js'
import { AuthService } from '../auth/service.js'
import { loadConfig } from '../config.js'
import { CredentialRepository } from '../credentials/credential-repository.js'
import { ProviderRepository } from '../providers/provider-repository.js'
import { buildServer } from '../server.js'
import { createPool } from '../storage/postgres/db.js'
import { CURRENT_SCHEMA_VERSION, createSchema, migrate } from '../storage/postgres/schema.js'
import { LOCAL_USER_ID } from '../threads/local-user.js'
import { ThreadRepository } from '../threads/thread-repository.js'
import { updateThreadRunSettings } from '../threads/thread-run-settings.js'
import { WorkspaceRepository } from '../workspaces/workspace-repository.js'

/** The real route, repositories and migration over an isolated set of tables for each case. */
const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('thread run settings routes (DATABASE_URL is not set)', () => {
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
    const schema = createSchema(`thread${run}_${caseIndex++}_`)
    await migrate(pool, schema)

    const threads = new ThreadRepository(pool, schema)
    const agents = new AgentRepository(pool, schema)
    const workspaces = new WorkspaceRepository(pool, schema)
    const providers = new ProviderRepository(pool, schema, config.secrets)
    const credentials = new CredentialRepository(pool, schema, config.secrets)
    const workspace = await workspaces.create(
      LOCAL_USER_ID,
      { name: 'Restricted', description: '', allowAll: false },
      'test-image',
    )
    const profile = await agents.default(workspace.id)
    if (profile === undefined) throw new Error('the workspace was created without its default agent')

    const key = await credentials.create(LOCAL_USER_ID, {
      kind: 'opencode-go',
      name: 'Workspace key',
      value: 'sk-route-test',
    })
    await providers.setWorkspaceProviders(LOCAL_USER_ID, workspace.id, {
      loginIds: [key.id],
      allowedModels: [DEFAULT_MODEL_ID],
      allowAllModels: false,
    })
    const thread = await threads.create(LOCAL_USER_ID, 1, { workspaceId: workspace.id, agentId: profile.id })

    const reachOf = async (workspaceId: string): Promise<WorkspaceReach> => {
      const [current, linked] = await Promise.all([
        workspaces.find(workspaceId),
        providers.workspaceProviders(LOCAL_USER_ID, workspaceId),
      ])
      if (current === undefined || linked === undefined) throw new Error('the test workspace is missing')

      return { allowAll: current.allowAll, ...linked }
    }
    const stores = {
      threads,
      agents,
      reachOf,
      keyCatalog: async () => ({
        loginIds: (await providers.logins(LOCAL_USER_ID)).map((login) => login.id),
        modelIds: new Set([DEFAULT_MODEL_ID, 'kimi-k3']),
      }),
    }
    const auth = new AuthService({ pool, schema, secrets: config.secrets })
    // Registration builds every route, while this suite exercises thread and answer endpoints through inject().
    const agent = {
      auth,
      capabilities: { skills: {} },
      thread: (id: string) => threads.find(id),
      toolCallDetails: async (id: string, callId: string) =>
        id === thread.id && callId === 'call-full'
          ? { arguments: '{"path":"README.md"}', result: 'the complete result' }
          : undefined,
      answerQuestion: async (_id: string, _callId: string, answer: string) => {
        if (answer === 'missing') return 'not-found'
        if (answer === 'duplicate') return 'already-answered'

        return 'answered'
      },
      updateThreadRunSettings: (id: string, patch: Parameters<typeof updateThreadRunSettings>[2]) =>
        updateThreadRunSettings(stores, id, patch),
    } as unknown as Agent

    return { server: buildServer(config, { agent }), thread, threads, key, pool, schema }
  }

  describe('thread run settings routes', () => {
    it('applies migration 19 with nullable override columns', async () => {
      const { server, pool, schema } = await serve()
      try {
        expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(19)
        await expect(
          pool.query(`SELECT credential_id, model_id, thinking_level FROM ${schema.tables.chatThreads} LIMIT 0`),
        ).resolves.toMatchObject({ rowCount: 0 })
      } finally {
        await server.close()
      }
    })

    it('sets and clears each override independently', async () => {
      const { server, thread, key } = await serve()
      try {
        const changed = await server.inject({
          method: 'PATCH',
          url: `/threads/${thread.id}/run-settings`,
          payload: { credentialId: key.id, modelId: DEFAULT_MODEL_ID, thinkingLevel: 'high' },
        })

        expect(changed.statusCode).toBe(200)
        expect(changed.json()).toMatchObject({
          overrides: { credentialId: key.id, modelId: DEFAULT_MODEL_ID, thinkingLevel: 'high' },
        })

        for (const [field, expected] of [
          ['credentialId', { credentialId: null, modelId: DEFAULT_MODEL_ID, thinkingLevel: 'high' }],
          ['modelId', { credentialId: null, modelId: null, thinkingLevel: 'high' }],
          ['thinkingLevel', { credentialId: null, modelId: null, thinkingLevel: null }],
        ] as const) {
          const cleared = await server.inject({
            method: 'PATCH',
            url: `/threads/${thread.id}/run-settings`,
            payload: { [field]: null },
          })
          expect(cleared.statusCode).toBe(200)
          expect(cleared.json()).toMatchObject({ overrides: expected })
        }
      } finally {
        await server.close()
      }
    })

    it('returns the full arguments and result for an expanded tool call', async () => {
      const { server, thread } = await serve()
      try {
        const response = await server.inject({
          method: 'GET',
          url: `/threads/${thread.id}/tool-calls/call-full`,
        })

        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({
          arguments: '{"path":"README.md"}',
          result: 'the complete result',
        })
      } finally {
        await server.close()
      }
    })

    it('answers a waiting question and distinguishes missing and already-answered calls', async () => {
      const { server, thread } = await serve()
      try {
        const answered = await server.inject({
          method: 'POST',
          url: `/threads/${thread.id}/questions/call-question/answer`,
          payload: { answer: 'Use the stable channel' },
        })
        expect(answered.statusCode).toBe(200)
        expect(answered.json()).toEqual({ answered: true })

        const duplicate = await server.inject({
          method: 'POST',
          url: `/threads/${thread.id}/questions/call-question/answer`,
          payload: { answer: 'duplicate' },
        })
        expect(duplicate.statusCode).toBe(409)
        expect(duplicate.json()).toMatchObject({ error: { code: 'QUESTION_ALREADY_ANSWERED' } })

        const missing = await server.inject({
          method: 'POST',
          url: `/threads/${thread.id}/questions/call-question/answer`,
          payload: { answer: 'missing' },
        })
        expect(missing.statusCode).toBe(404)
        expect(missing.json()).toMatchObject({ error: { code: 'QUESTION_NOT_FOUND' } })
      } finally {
        await server.close()
      }
    })

    it('refuses a known model the workspace does not allow', async () => {
      const { server, thread, threads } = await serve()
      try {
        const refused = await server.inject({
          method: 'PATCH',
          url: `/threads/${thread.id}/run-settings`,
          payload: { modelId: 'kimi-k3' },
        })
        expect(refused.statusCode).toBe(400)
        expect(refused.json()).toMatchObject({ error: { code: 'AGENT_MODEL_NOT_ALLOWED' } })
        await expect(threads.find(thread.id)).resolves.toMatchObject({
          overrides: { credentialId: null, modelId: null, thinkingLevel: null },
        })
      } finally {
        await server.close()
      }
    })
  })
}
