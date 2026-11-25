import type { ContainerRuntime } from '../environments/container-runtime.js'
import type { EnvironmentRepository } from '../environments/environment-repository.js'
import type { SshKeyStore } from './ssh-key-repository.js'

export interface AuthorizedKeyDeliveryOptions {
  readonly ownerId: string
  readonly keys: SshKeyStore
  readonly environments: Pick<EnvironmentRepository, 'list'>
  readonly containers: Pick<ContainerRuntime, 'status' | 'replaceAuthorizedKeys'>
  /** Told about a container that could not take the keys; the default warns the operator through the process. */
  readonly onFailure?: (environmentId: string, error: unknown) => void
}

const warn = (environmentId: string, error: unknown): void => {
  const reason = error instanceof Error ? error.message : String(error)
  process.emitWarning(`SSH keys were not written to environment ${environmentId}: ${reason}`, {
    code: 'CAKE_SSH_KEY_DELIVERY',
  })
}

/**
 * One complete rewrite per running container makes deletion as important as addition; stopped ones update on start.
 *
 * Best effort per container: the key is already stored when this runs, and every start writes the full list again, so
 * a container that is restarting or unreachable right now must not fail the request that saved the key (a generated
 * private key would otherwise never reach the person) nor stop the other containers from getting it.
 */
export const createAuthorizedKeyDelivery = (options: AuthorizedKeyDeliveryOptions): (() => Promise<void>) =>
  async () => {
    const onFailure = options.onFailure ?? warn
    const publicKeys = await options.keys.publicKeys(options.ownerId)
    for (const environment of await options.environments.list(options.ownerId)) {
      if (environment.containerId === null) continue
      try {
        if (await options.containers.status(environment.containerId) === 'running') {
          await options.containers.replaceAuthorizedKeys(environment.containerId, publicKeys)
        }
      } catch (error) {
        onFailure(environment.id, error)
      }
    }
  }
