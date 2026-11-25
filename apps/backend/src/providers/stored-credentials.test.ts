import { createModels } from '@earendil-works/pi-ai/models'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { describe, expect, it } from 'vitest'

import type { ProviderLogin } from './provider-repository.js'
import { registerKeyProvider, storedCredentials } from './stored-credentials.js'
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
  it('answers each key under its own provider id, and the newest under the bare provider', async () => {
    const store = storedCredentials(keysOf([['new', 'key-new'], ['old', 'key-old']]), OWNER)

    await expect(store.read('opencode-go~old')).resolves.toEqual({ type: 'api_key', key: 'key-old' })
    await expect(store.read('opencode-go~new')).resolves.toEqual({ type: 'api_key', key: 'key-new' })
    await expect(store.read('opencode-go')).resolves.toEqual({ type: 'api_key', key: 'key-new' })
    await expect(store.list()).resolves.toEqual([
      { providerId: 'opencode-go~new', type: 'api_key' },
      { providerId: 'opencode-go~old', type: 'api_key' },
    ])
  })

  it('knows nothing about other providers, unknown keys or an owner without keys', async () => {
    await expect(storedCredentials(keysOf([['a', 'key-a']]), OWNER).read('anthropic')).resolves.toBeUndefined()
    await expect(storedCredentials(keysOf([['a', 'key-a']]), OWNER).read('opencode-go~zzz')).resolves.toBeUndefined()
    await expect(storedCredentials(keysOf([]), OWNER).read('opencode-go')).resolves.toBeUndefined()
    await expect(storedCredentials(keysOf([]), OWNER).list()).resolves.toEqual([])
  })

  it('refuses writes: keys are stored through the credentials API', async () => {
    const store = storedCredentials(keysOf([]), OWNER)

    await expect(store.modify('opencode-go', async (current) => current)).rejects.toThrow('credentials API')
    await expect(store.delete('opencode-go')).rejects.toThrow('credentials API')
  })
})

describe('registerKeyProvider', () => {
  it('makes a model runnable under one key, authenticated with exactly that key', async () => {
    const models = createModels({
      credentials: storedCredentials(keysOf([['first', 'key-first'], ['second', 'key-second']]), OWNER),
      authContext: emptyEnvironment,
    })
    models.setProvider(opencodeGoProvider())
    registerKeyProvider(models, 'second')
    // Idempotent: a second registration of the same key changes nothing.
    registerKeyProvider(models, 'second')

    const model = models.getModel('opencode-go~second', 'deepseek-v4.1-flash')
    expect(model?.provider).toBe('opencode-go~second')
    if (model === undefined) return

    await expect(models.getAuth(model)).resolves.toMatchObject({ auth: { apiKey: 'key-second' } })
    expect(models.getModel('opencode-go~first', 'deepseek-v4.1-flash')).toBeUndefined()
  })
})
