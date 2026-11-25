import { generateSshKeyPair } from './openssh-private-key.js'
import { validatePublicKey } from './public-key.js'
import type { SshKeyStore, UserSshKey } from './ssh-key-repository.js'

export interface GeneratedUserSshKey {
  readonly key: UserSshKey
  readonly privateKey: string
  readonly filename: 'cake_ed25519'
}

export interface SshKeyApi {
  list(): Promise<UserSshKey[]>
  upload(name: string, publicKey: string): Promise<UserSshKey>
  generate(name: string): Promise<GeneratedUserSshKey>
  remove(id: string): Promise<boolean>
}

export interface SshKeyApiOptions {
  readonly ownerId: string
  readonly keys: SshKeyStore
  /** Replaces authorized_keys in every running container owned by this user after a successful write. */
  readonly onChange: () => Promise<void>
}

export const createSshKeyApi = (options: SshKeyApiOptions): SshKeyApi => ({
  list: () => options.keys.list(options.ownerId),

  upload: async (name, source) => {
    const validated = validatePublicKey(source)
    const key = await options.keys.create(options.ownerId, name.trim(), validated.publicKey, validated.fingerprint)
    await options.onChange()

    return key
  },

  generate: async (name) => {
    const pair = generateSshKeyPair()
    const validated = validatePublicKey(pair.publicKey)
    const key = await options.keys.create(options.ownerId, name.trim(), validated.publicKey, validated.fingerprint)
    await options.onChange()

    return { key, privateKey: pair.privateKey, filename: 'cake_ed25519' }
  },

  remove: async (id) => {
    const removed = await options.keys.remove(options.ownerId, id)
    if (removed) await options.onChange()

    return removed
  },
})
