import type { CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'

import type { ProviderRepository } from './provider-repository.js'
import { SUPPORTED_PROVIDER } from './provider-repository.js'

/** The two reads this store makes, so a test can answer without a database. */
export type StoredKeys = Pick<ProviderRepository, 'logins' | 'key'>

const readOnly = async (): Promise<never> => {
  throw new Error('provider keys are written through the providers API, not by the model runtime')
}

/**
 * The model runtime's view of the keys a user stored on the credentials page. Without it the harness only ever read
 * `OPENCODE_API_KEY` from the environment, so a key added in the app was checked, listed and never used.
 *
 * The newest login of the supported provider answers. Which login pays for which workspace (`docs/providers.md`) needs
 * the harness to resolve credentials per conversation, which it does not do yet; until then one key serves every chat.
 * `envApiKeyAuth` prefers a stored credential, so `OPENCODE_API_KEY` remains the fallback when no key is stored.
 */
export const storedCredentials = (keys: StoredKeys, ownerId: string): CredentialStore => {
  const newestLogin = async (providerId: string) => {
    if (providerId !== SUPPORTED_PROVIDER) return undefined
    const [newest] = await keys.logins(ownerId)

    return newest
  }

  return {
    async read(providerId) {
      const login = await newestLogin(providerId)
      if (login === undefined) return undefined

      const key = await keys.key(ownerId, login.id)

      return key === undefined ? undefined : { type: 'api_key', key }
    },

    async list() {
      const logins = await keys.logins(ownerId)
      const info: CredentialInfo = { providerId: SUPPORTED_PROVIDER, type: 'api_key' }

      return logins.length === 0 ? [] : [info]
    },

    modify: readOnly,
    delete: readOnly,
  }
}
