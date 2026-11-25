import type { Credential, CredentialInput, CredentialRepository } from './credential-repository.js'

export interface CredentialApiOptions {
  readonly ownerId: string
  readonly credentials: CredentialRepository
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
  create: (input) => options.credentials.create(options.ownerId, input),
  remove: (id) => options.credentials.remove(options.ownerId, id),
})
