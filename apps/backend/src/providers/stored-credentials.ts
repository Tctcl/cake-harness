import type { CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import type { MutableModels, Provider } from '@earendil-works/pi-ai/models'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'

import { credentialIdOf, providerIdFor, PROVIDER } from '../agents/run-settings.js'
import type { ProviderRepository } from './provider-repository.js'

/** The two reads this store makes, so a test can answer without a database. */
export type StoredKeys = Pick<ProviderRepository, 'logins' | 'key'>

const readOnly = async (): Promise<never> => {
  throw new Error('provider keys are written through the credentials API, not by the model runtime')
}

/**
 * The model runtime's view of the keys a user stored on the credentials page.
 *
 * Every stored key is its own provider (`opencode-go~<credential id>`, see `registerKeyProvider`), so a conversation's
 * model reference names the key that pays for it and this store answers exactly that key. The bare `opencode-go`
 * provider is what conversations created before per-agent keys still name; it answers the newest stored key, and
 * `envApiKeyAuth` falls back to `OPENCODE_API_KEY` when there is none.
 */
export const storedCredentials = (keys: StoredKeys, ownerId: string): CredentialStore => ({
  async read(providerId) {
    const credentialId = credentialIdOf(providerId)
    const id = credentialId ?? (providerId === PROVIDER ? (await keys.logins(ownerId))[0]?.id : undefined)
    if (id === undefined) return undefined

    const key = await keys.key(ownerId, id)

    return key === undefined ? undefined : { type: 'api_key', key }
  },

  async list() {
    const logins = await keys.logins(ownerId)

    return logins.map((login): CredentialInfo => ({ providerId: providerIdFor(login.id), type: 'api_key' }))
  },

  modify: readOnly,
  delete: readOnly,
})

/**
 * Registers one stored key as a provider: OpenCode Go's catalog and API under the key's own id. Idempotent, so it is
 * called whenever a run is about to use a key, and once per key at startup so a run resumed after a restart finds it.
 */
export const registerKeyProvider = (models: MutableModels, credentialId: string): void => {
  const id = providerIdFor(credentialId)
  if (models.getProvider(id) !== undefined) return

  const base: Provider = opencodeGoProvider()
  const relabel = <M extends { readonly provider: string }>(model: M): M => ({ ...model, provider: id })

  models.setProvider({
    ...base,
    id,
    getModels: () => base.getModels().map(relabel),
    ...(base.getAllModels === undefined ? {} : { getAllModels: () => (base.getAllModels?.() ?? []).map(relabel) }),
  })
}
