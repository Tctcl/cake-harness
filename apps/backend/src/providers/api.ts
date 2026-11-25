import { AppError } from '../errors.js'
import type { ProviderKeyCheck, UpstreamModel } from './provider-client.js'
import type {
  ProviderLogin,
  ProviderLoginInput,
  ProviderModel,
  ProviderRepository,
  ProviderUsage,
  WorkspaceProviders,
} from './provider-repository.js'
import { SUPPORTED_PROVIDER } from './provider-repository.js'

/** The two upstream calls this feature makes, passed in so a test can answer without a network. */
export interface ProviderClient {
  checkKey(key: string): Promise<ProviderKeyCheck>
  fetchModels(key: string): Promise<readonly UpstreamModel[] | undefined>
}

export interface ProviderApiOptions {
  readonly ownerId: string
  readonly providers: ProviderRepository
  readonly client: ProviderClient
}

/**
 * One user's provider logins and one workspace's selection from them. The owner is bound here rather than passed by a
 * route, so a request cannot name somebody else's key.
 */
export interface ProviderApi {
  logins(): Promise<readonly ProviderLogin[]>
  /** Checks the key upstream before storing it, and refreshes the model cache from the same key. */
  createLogin(input: ProviderLoginInput): Promise<ProviderLogin>
  models(): Promise<readonly ProviderModel[]>
  workspaceProviders(workspaceId: string): Promise<WorkspaceProviders>
  setWorkspaceProviders(workspaceId: string, providers: WorkspaceProviders): Promise<WorkspaceProviders>
  usage(workspaceId: string): Promise<readonly ProviderUsage[]>
}

/** A workspace that is unknown and one that is somebody else's are one answer, because the repository cannot tell. */
const notFound = (): AppError => new AppError('workspace not found', { statusCode: 404, code: 'WORKSPACE_NOT_FOUND' })

/** A refused key is the user's to fix; an unreachable provider is not, so the two carry different statuses. */
const keyProblem = (check: Extract<ProviderKeyCheck, { ok: false }>): AppError => {
  if (check.problem === 'invalid') {
    return new AppError(check.message, { statusCode: 400, code: 'PROVIDER_KEY_INVALID' })
  }

  if (check.problem === 'entitlement') {
    return new AppError(check.message, { statusCode: 400, code: 'PROVIDER_KEY_NOT_ENTITLED' })
  }

  return new AppError(check.message, { statusCode: 502, code: 'PROVIDER_UNAVAILABLE' })
}

export const createProviderApi = (options: ProviderApiOptions): ProviderApi => {
  const { ownerId, providers, client } = options

  return {
    logins: () => providers.logins(ownerId),

    createLogin: async (input: ProviderLoginInput) => {
      // Only one provider is served today, and saying so is better than storing a key nothing can spend.
      if (input.provider !== SUPPORTED_PROVIDER) {
        throw new AppError(`${input.provider} is not supported yet`, {
          statusCode: 400,
          code: 'PROVIDER_UNSUPPORTED',
        })
      }

      const check = await client.checkKey(input.key)
      if (!check.ok) throw keyProblem(check)

      const login = await providers.createLogin(ownerId, crypto.randomUUID(), input)

      // The catalog is refreshed by the key that can read it, and a failure here must not undo the stored login: the
      // key is valid, the list is a cache, and the next load retries it.
      const models = await client.fetchModels(input.key)
      if (models !== undefined) await providers.replaceModels(SUPPORTED_PROVIDER, models)

      return login
    },

    models: () => providers.models(SUPPORTED_PROVIDER),

    workspaceProviders: async (workspaceId: string) =>
      (await providers.workspaceProviders(ownerId, workspaceId)) ?? Promise.reject(notFound()),

    setWorkspaceProviders: async (workspaceId: string, input: WorkspaceProviders) =>
      (await providers.setWorkspaceProviders(ownerId, workspaceId, input)) ?? Promise.reject(notFound()),

    usage: async (workspaceId: string) => (await providers.usage(ownerId, workspaceId)) ?? Promise.reject(notFound()),
  }
}
