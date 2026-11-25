import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { createSecretBox } from '../auth/secret-box.js'
import { createSchema, openPostgresStorage } from '../storage/postgres/index.js'
import { ensureLocalUser } from '../threads/local-user.js'
import { WorkspaceRepository } from '../workspaces/workspace-repository.js'
import { createCredentialApi } from '../credentials/api.js'
import { CredentialRepository } from '../credentials/credential-repository.js'
import { createProviderApi } from './api.js'
import type { ProviderKeyCheck, UpstreamModel } from './provider-client.js'
import { ProviderRepository } from './provider-repository.js'

/** Live-server suite like its neighbours: `DATABASE_URL` names a disposable database, and every case gets a prefix. */
const IMAGE = 'tctcl/dev-env:dev'

const MODEL: UpstreamModel = {
  id: 'anthropic/claude-sonnet-4',
  name: 'Claude Sonnet 4',
  contextWindow: 200_000,
  maxOutput: 64_000,
  inputUsdPerMillion: 3,
  outputUsdPerMillion: 15,
  supportsReasoning: true,
  supportsTools: true,
}

/** The upstream is a collaborator, not the subject: a test answers for it and nothing reaches the network. */
interface Upstream {
  checkKey(key: string): Promise<ProviderKeyCheck>
  fetchModels(key: string): Promise<readonly UpstreamModel[] | undefined>
}

const client = (overrides: Partial<Upstream> = {}): Upstream => ({
  checkKey: async () => ({ ok: true }),
  fetchModels: async () => [MODEL],
  ...overrides,
})

const url = process.env['DATABASE_URL']

if (url === undefined) {
  describe.skip('ProviderApi (DATABASE_URL is not set)', () => {
    it('is covered against a live server only', () => {})
  })
} else {
  const run = Math.random().toString(36).slice(2, 8)
  let caseIndex = 0
  const created: string[] = []

  const withApi = async (
    use: (world: {
      api: ReturnType<typeof createProviderApi>
      addKey: (label: string, key: string) => Promise<{ readonly id: string }>
      providers: ProviderRepository
      workspaces: WorkspaceRepository
      ownerId: string
    }) => Promise<void>,
    overrides: Partial<Upstream> = {},
  ): Promise<void> => {
    const prefix = `p${run}_${caseIndex++}_`
    const storage = await openPostgresStorage(url, { prefix })
    created.push(...Object.values(createSchema(prefix).tables))
    try {
      const ownerId = await ensureLocalUser(storage.pool, storage.schema)
      const schema = storage.schema
      const workspaces = new WorkspaceRepository(storage.pool, schema)
      const secrets = createSecretBox('provider-test-key')
      const providers = new ProviderRepository(storage.pool, schema, secrets)
      const api = createProviderApi({ ownerId, providers })
      // Keys arrive through the credentials page, with the same upstream hooks the app wires in agent.ts.
      const upstream = client(overrides)
      const credentials = createCredentialApi({
        ownerId,
        credentials: new CredentialRepository(storage.pool, schema, secrets),
        providerKeys: {
          check: upstream.checkKey,
          stored: async (_id, key) => {
            const models = await upstream.fetchModels(key)
            if (models !== undefined) await providers.replaceModels('opencode-go', models)
          },
        },
      })
      const addKey = (label: string, key: string) =>
        credentials.create({ kind: 'opencode-go', name: label, value: key })

      await use({ api, addKey, providers, workspaces, ownerId })
    } finally {
      await storage.close({} as never)
    }
  }

  describe('ProviderApi', () => {
    it('lists a stored key by its label, never the key, and opens it only for its owner', async () => {
      await withApi(async ({ api, addKey, providers, ownerId }) => {
        const login = await addKey('personal', 'sk-live-123')

        await expect(api.logins()).resolves.toEqual([
          { id: login.id, provider: 'opencode-go', label: 'personal', createdAt: expect.any(String) },
        ])
        expect(JSON.stringify(await api.logins())).not.toContain('sk-live-123')
        await expect(providers.key(ownerId, login.id)).resolves.toBe('sk-live-123')
        await expect(providers.key(login.id, login.id)).resolves.toBeUndefined()
      })
    })

    it('stores nothing when the provider rejects the key, and says which way it failed', async () => {
      await withApi(
        async ({ api, addKey }) => {
          await expect(addKey('x', 'bad')).rejects.toMatchObject({
            code: 'PROVIDER_KEY_INVALID',
            statusCode: 400,
          })
          await expect(api.logins()).resolves.toEqual([])
        },
        { checkKey: async () => ({ ok: false, problem: 'invalid', message: 'the provider rejected the key' }) },
      )
    })

    it('treats an unreachable provider as a server failure, not a bad key', async () => {
      await withApi(
        async ({ addKey }) => {
          await expect(addKey('x', 'sk')).rejects.toMatchObject({
            code: 'PROVIDER_UNAVAILABLE',
            statusCode: 502,
          })
        },
        { checkKey: async () => ({ ok: false, problem: 'unavailable', message: 'the provider could not be reached' }) },
      )
    })

    it('fills the catalog from the key that just proved itself', async () => {
      await withApi(async ({ api, addKey }) => {
        await expect(api.models()).resolves.toEqual([])
        await addKey('personal', 'sk')
        await expect(api.models()).resolves.toEqual([{ ...MODEL, provider: 'opencode-go' }])
      })
    })

    it('keeps the login when the catalog call fails, because the key is what was stored', async () => {
      await withApi(
        async ({ api, addKey }) => {
          await addKey('personal', 'sk')

          await expect(api.logins()).resolves.toHaveLength(1)
          await expect(api.models()).resolves.toEqual([])
        },
        { fetchModels: async () => undefined },
      )
    })

    it('round-trips what a workspace may spend and starts it empty', async () => {
      await withApi(async ({ api, addKey, workspaces, ownerId }) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)
        const login = await addKey('personal', 'sk')

        await expect(api.workspaceProviders(workspace.id)).resolves.toEqual({
          loginIds: [],
          allowedModels: [],
          allowAllModels: false,
        })

        const saved = { loginIds: [login.id], allowedModels: [MODEL.id], allowAllModels: false }

        await expect(api.setWorkspaceProviders(workspace.id, saved)).resolves.toEqual(saved)
        await expect(api.workspaceProviders(workspace.id)).resolves.toEqual(saved)
      })
    })

    it('answers not found for a workspace that does not exist, and for somebody else s', async () => {
      await withApi(async ({ api }) => {
        const missing = '00000000-0000-4000-8000-000000000001'

        await expect(api.workspaceProviders(missing)).rejects.toMatchObject({
          code: 'WORKSPACE_NOT_FOUND',
          statusCode: 404,
        })
        await expect(
          api.setWorkspaceProviders(missing, { loginIds: [], allowedModels: [], allowAllModels: false }),
        ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND', statusCode: 404 })
        await expect(api.usage(missing)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND', statusCode: 404 })
      })
    })

    it('counts the logins a workspace links, and nothing before it links one', async () => {
      await withApi(async ({ api, addKey, workspaces, ownerId }) => {
        const workspace = await workspaces.create(ownerId, { name: 'Platform' }, IMAGE)

        await expect(api.usage(workspace.id)).resolves.toEqual([])

        const login = await addKey('personal', 'sk')
        await api.setWorkspaceProviders(workspace.id, { loginIds: [login.id], allowedModels: [], allowAllModels: false })

        await expect(api.usage(workspace.id)).resolves.toEqual([
          { provider: 'opencode-go', loginCount: 1, requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        ])
      })
    })
  })

  afterAll(async () => {
    if (created.length === 0) return
    const client = new Client({ connectionString: url })
    await client.connect()
    try {
      for (const table of created) {
        const drop = `DROP TABLE IF EXISTS ${table} CASCADE`
        await client.query(drop)
      }
    } finally {
      await client.end()
    }
  }, 60_000)
}
