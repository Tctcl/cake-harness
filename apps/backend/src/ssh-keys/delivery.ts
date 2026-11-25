import type { ContainerRuntime } from '../environments/container-runtime.js'
import type { EnvironmentRepository } from '../environments/environment-repository.js'
import type { SshKeyStore } from './ssh-key-repository.js'

export interface AuthorizedKeyDeliveryOptions {
  readonly ownerId: string
  readonly keys: SshKeyStore
  readonly environments: Pick<EnvironmentRepository, 'list'>
  readonly containers: Pick<ContainerRuntime, 'status' | 'replaceAuthorizedKeys'>
}

/** One complete rewrite per running container makes deletion as important as addition; stopped ones update on start. */
export const createAuthorizedKeyDelivery = (options: AuthorizedKeyDeliveryOptions): (() => Promise<void>) =>
  async () => {
    const publicKeys = await options.keys.publicKeys(options.ownerId)
    for (const environment of await options.environments.list(options.ownerId)) {
      if (environment.containerId === null) continue
      if (await options.containers.status(environment.containerId) === 'running') {
        await options.containers.replaceAuthorizedKeys(environment.containerId, publicKeys)
      }
    }
  }
