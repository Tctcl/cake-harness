import { keyProblem } from '../providers/api.js'
import type { ProviderKeyCheck } from '../providers/provider-client.js'
import type { Credential, CredentialInput, CredentialRepository } from './credential-repository.js'

/**
 * What happens to an OpenCode Go key around storing it: it is checked against the provider first, so a mistyped key is
 * refused on the page that took it, and once stored it becomes a provider the model runtime can use.
 */
export interface ProviderKeyHooks {
  check(key: string): Promise<ProviderKeyCheck>
  stored(credentialId: string, key: string): Promise<void>
}

export interface CredentialApiOptions {
  readonly ownerId: string
  readonly credentials: CredentialRepository
  readonly providerKeys?: ProviderKeyHooks
}

/**
 * The credential list of one user. The owner is bound here rather than passed by every caller, so a route can never ask
 * for somebody else's keys by accident.
 */
export interface CredentialApi {
  list(): Promise<Credential[]>
  create(input: CredentialInput): Promise<Credential>
  /** `false` when the id is unknown. */
  remove(id: string): Promise<boolean>
}

export const createCredentialApi = (options: CredentialApiOptions): CredentialApi => ({
  list: () => options.credentials.list(options.ownerId),

  create: async (input) => {
    const hooks = input.kind === 'opencode-go' ? options.providerKeys : undefined
    if (hooks !== undefined) {
      const check = await hooks.check(input.value)
      if (!check.ok) throw keyProblem(check)
    }

    const created = await options.credentials.create(options.ownerId, input)
    await hooks?.stored(created.id, input.value)

    return created
  },

  remove: (id) => options.credentials.remove(options.ownerId, id),
})
