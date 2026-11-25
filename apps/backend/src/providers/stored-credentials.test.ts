import { createModels } from '@earendil-works/pi-ai/models'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { describe, expect, it } from 'vitest'

import type { ProviderLogin } from './provider-repository.js'
import { storedCredentials } from './stored-credentials.js'
import type { StoredKeys } from './stored-credentials.js'

const OWNER = 'owner-1'

const login = (id: string): ProviderLogin => ({ id, provider: 'opencode-go', label: id, createdAt: '2026-11-25T00:00:00Z' })

/** Logins newest first, the order the repository answers in, each with its key in the clear. */
const keysOf = (entries: readonly (readonly [string, string])[]): StoredKeys => ({
  logins: async (ownerId) => (ownerId === OWNER ? entries.map(([id]) => login(id)) : []),
  key: async (ownerId, id) => (ownerId === OWNER ? entries.find(([entry]) => entry === id)?.[1] : undefined),
})

/** No environment at all, so a resolved key can only have come from the store. */
const emptyEnvironment = { env: async () => undefined, fileExists: async () => false }

describe('storedCredentials', () => {
  it('answers the newest stored key for the supported provider', async () => {
    const store = storedCredentials(keysOf([['new', 'key-new'], ['old', 'key-old']]), OWNER)

    await expect(store.read('opencode-go')).resolves.toEqual({ type: 'api_key', key: 'key-new' })
    await expect(store.list()).resolves.toEqual([{ providerId: 'opencode-go', type: 'api_key' }])
  })

  it('knows nothing about other providers or an owner without keys', async () => {
    await expect(storedCredentials(keysOf([['a', 'key-a']]), OWNER).read('anthropic')).resolves.toBeUndefined()
    await expect(storedCredentials(keysOf([]), OWNER).read('opencode-go')).resolves.toBeUndefined()
    await expect(storedCredentials(keysOf([]), OWNER).list()).resolves.toEqual([])
  })

  it('refuses writes: keys are stored through the providers API', async () => {
    const store = storedCredentials(keysOf([]), OWNER)

    await expect(store.modify('opencode-go', async (current) => current)).rejects.toThrow('providers API')
    await expect(store.delete('opencode-go')).rejects.toThrow('providers API')
  })

  it('is what the model runtime authenticates with when the environment has no key', async () => {
    const models = createModels({
      credentials: storedCredentials(keysOf([['only', 'key-from-the-app']]), OWNER),
      authContext: emptyEnvironment,
    })
    models.setProvider(opencodeGoProvider())

    const model = models.getModel('opencode-go', 'deepseek-v4.1-flash')
    expect(model).toBeDefined()
    if (model === undefined) return

    await expect(models.getAuth(model)).resolves.toMatchObject({ auth: { apiKey: 'key-from-the-app' } })
  })
})
