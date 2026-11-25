import { AppError } from '../errors.js'
import type { ProviderKeyCheck } from './provider-client.js'
import type {
  ProviderLogin,
  ProviderModel,
  ProviderRepository,
  ProviderUsage,
  WorkspaceProviders,
} from './provider-repository.js'
import { SUPPORTED_PROVIDER } from './provider-repository.js'

export interface ProviderApiOptions {
  readonly ownerId: string
  readonly providers: ProviderRepository
}

/**
 * One user's provider logins and one workspace's selection from them. The owner is bound here rather than passed by a
 * route, so a request cannot name somebody else's key. Keys are added on the credentials page (`credentials/api.ts`),
 * which checks them upstream and loads their models; this api only reads them and links them to workspaces.
 */
export interface ProviderApi {
  logins(): Promise<readonly ProviderLogin[]>
  models(): Promise<readonly ProviderModel[]>
  workspaceProviders(workspaceId: string): Promise<WorkspaceProviders>
  setWorkspaceProviders(workspaceId: string, providers: WorkspaceProviders): Promise<WorkspaceProviders>
  usage(workspaceId: string): Promise<readonly ProviderUsage[]>
}

/** A workspace that is unknown and one that is somebody else's are one answer, because the repository cannot tell. */
const notFound = (): AppError => new AppError('workspace not found', { statusCode: 404, code: 'WORKSPACE_NOT_FOUND' })

/** A refused key is the user's to fix; an unreachable provider is not, so the two carry different statuses. */
export const keyProblem = (check: Extract<ProviderKeyCheck, { ok: false }>): AppError => {
  if (check.problem === 'invalid') {
    return new AppError(check.message, { statusCode: 400, code: 'PROVIDER_KEY_INVALID' })
  }

  if (check.problem === 'entitlement') {
    return new AppError(check.message, { statusCode: 400, code: 'PROVIDER_KEY_NOT_ENTITLED' })
  }

  return new AppError(check.message, { statusCode: 502, code: 'PROVIDER_UNAVAILABLE' })
}

export const createProviderApi = (options: ProviderApiOptions): ProviderApi => {
  const { ownerId, providers } = options

  return {
    logins: () => providers.logins(ownerId),

    models: () => providers.models(SUPPORTED_PROVIDER),

    workspaceProviders: async (workspaceId: string) =>
      (await providers.workspaceProviders(ownerId, workspaceId)) ?? Promise.reject(notFound()),

    setWorkspaceProviders: async (workspaceId: string, input: WorkspaceProviders) =>
      (await providers.setWorkspaceProviders(ownerId, workspaceId, input)) ?? Promise.reject(notFound()),

    usage: async (workspaceId: string) => (await providers.usage(ownerId, workspaceId)) ?? Promise.reject(notFound()),
  }
}
