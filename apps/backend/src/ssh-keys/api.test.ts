import { describe, expect, it, vi } from 'vitest'

import { createSshKeyApi } from './api.js'
import { generateSshKeyPair } from './openssh-private-key.js'
import type { SshKeyStore, UserSshKey } from './ssh-key-repository.js'

const OWNER_ID = '00000000-0000-4000-8000-000000000001'

const storeOf = () => {
  const writes: { name: string; publicKey: string; fingerprint: string }[] = []
  const store: SshKeyStore = {
    list: async () => [],
    publicKeys: async () => writes.map((write) => write.publicKey),
    create: async (_ownerId, name, publicKey, fingerprint) => {
      writes.push({ name, publicKey, fingerprint })

      return {
        id: '00000000-0000-4000-8000-000000000002',
        name,
        publicKey,
        fingerprint,
        createdAt: new Date(0).toISOString(),
      } satisfies UserSshKey
    },
    remove: async () => true,
  }

  return { store, writes }
}

describe('SshKeyApi', () => {
  it('generates a private key once but gives the store only public material', async () => {
    const { store, writes } = storeOf()
    const onChange = vi.fn(async () => undefined)
    const generated = await createSshKeyApi({ ownerId: OWNER_ID, keys: store, onChange }).generate('Laptop')

    expect(generated.filename).toBe('cake_ed25519')
    expect(generated.privateKey).toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.publicKey).toBe(generated.key.publicKey)
    expect(JSON.stringify(writes)).not.toContain('PRIVATE KEY')
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('delivers an uploaded key after validating it', async () => {
    const { store, writes } = storeOf()
    const pair = generateSshKeyPair()
    const onChange = vi.fn(async () => undefined)
    const api = createSshKeyApi({ ownerId: OWNER_ID, keys: store, onChange })

    await api.upload('Laptop', `${pair.publicKey} a-comment`)
    expect(writes[0]?.publicKey).toBe(pair.publicKey)
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('rewrites running containers after deleting a key, but not after an unknown id', async () => {
    const { store } = storeOf()
    const onChange = vi.fn(async () => undefined)
    const unknownStore: SshKeyStore = { ...store, remove: async () => false }
    const api = createSshKeyApi({ ownerId: OWNER_ID, keys: unknownStore, onChange })

    expect(await api.remove('missing')).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })
})
