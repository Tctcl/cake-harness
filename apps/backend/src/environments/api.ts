import type { ContainerRuntime } from './container-runtime.js'
import type {
  DevEnvironment,
  EnvironmentPatch,
  EnvironmentRepository,
} from './environment-repository.js'

export interface EnvironmentApiOptions {
  readonly ownerId: string
  readonly environments: EnvironmentRepository
  readonly containers: ContainerRuntime
  /** The image a new environment records, before it has ever been started. */
  readonly image: string
}

/**
 * The environments a user owns and the links that hand them to workspaces and agents. Provisions through the
 * `ContainerRuntime` injected here, so the routes decide nothing about Docker and a test can answer for it.
 */
export interface EnvironmentApi {
  list(): Promise<DevEnvironment[]>
  find(id: string): Promise<DevEnvironment | undefined>
  create(name: string): Promise<DevEnvironment>
  update(id: string, patch: EnvironmentPatch): Promise<DevEnvironment | undefined>
  /** Stop and remove the container first, then the row; `false` when the id is unknown. */
  remove(id: string): Promise<boolean>
  /** Create the container if it is missing, start it, and record what Docker called it. */
  start(id: string): Promise<DevEnvironment | undefined>
  stop(id: string): Promise<DevEnvironment | undefined>
  ofWorkspace(workspaceId: string): Promise<DevEnvironment[]>
  workspacesOf(environmentId: string): Promise<string[]>
  ofAgent(agentId: string): Promise<DevEnvironment | undefined>
  attach(workspaceId: string, environmentId: string): Promise<boolean>
  detach(workspaceId: string, environmentId: string): Promise<boolean>
  connectAgent(agentId: string, environmentId: string): Promise<void>
  disconnectAgent(agentId: string): Promise<boolean>
}

export const createEnvironmentApi = (options: EnvironmentApiOptions): EnvironmentApi => {
  const { environments, containers } = options

  return {
    list: () => environments.list(options.ownerId),
    find: (id) => environments.find(id),
    create: (name) => environments.create(options.ownerId, { name, image: options.image }),
    update: (id, patch) => environments.update(id, patch),

    remove: async (id) => {
      const environment = await environments.find(id)
      if (environment === undefined) return false

      // The container goes first: a row that outlived its container is recoverable, a container nobody names is not.
      if (environment.containerId !== null) await containers.remove(environment.containerId)

      return environments.remove(id)
    },

    start: async (id) => {
      const environment = await environments.find(id)
      if (environment === undefined) return undefined

      const containerId = await containers.ensureRunning(
        { id: environment.id, image: environment.image },
        environment.containerId,
      )

      return environments.setContainer(id, containerId)
    },

    stop: async (id) => {
      const environment = await environments.find(id)
      if (environment === undefined) return undefined
      // The recorded id stays: the container is stopped, not gone, and the next start reuses it.
      if (environment.containerId !== null) await containers.stop(environment.containerId)

      return environment
    },

    ofWorkspace: (workspaceId) => environments.ofWorkspace(workspaceId),
    workspacesOf: (environmentId) => environments.workspacesOf(environmentId),
    ofAgent: (agentId) => environments.ofAgent(agentId),
    attach: (workspaceId, environmentId) => environments.attach(workspaceId, environmentId),
    detach: (workspaceId, environmentId) => environments.detach(workspaceId, environmentId),
    connectAgent: (agentId, environmentId) => environments.connectAgent(agentId, environmentId),
    disconnectAgent: (agentId) => environments.disconnectAgent(agentId),
  }
}
