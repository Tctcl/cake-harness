import type { ContainerMetrics, ContainerRuntime, ContainerStatus } from './container-runtime.js'
import type { SshAccessView } from './ssh-access.js'
import { sshAccessOf } from './ssh-access.js'
import type {
  DevEnvironment,
  EnvironmentPatch,
  EnvironmentRepository,
  ReportedState,
} from './environment-repository.js'
import { buildManifest } from './manifest.js'
import type { EnvironmentManifest } from './manifest.js'
import type { SecretReader } from '../secrets/ciphergate.js'

export interface EnvironmentApiOptions {
  readonly ownerId: string
  readonly environments: EnvironmentRepository
  readonly containers: ContainerRuntime
  /** The image a new environment records, before it has ever been started. */
  readonly image: string
  /**
   * Where a workspace container reaches this backend for its documents, or `null` when it is not wired to fetch them.
   * The container derives its own paths from it, so nothing about a particular environment is baked in here.
   */
  readonly backendUrl: string | null
  /** The network the container joins so `backend` resolves, or `null` to leave it on Docker's default one. */
  readonly network: string | null
  /** Where the credentials a workspace gets come from; a reader that knows nothing serves a manifest without any. */
  readonly secrets: SecretReader
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
  /** What Docker says about the container now; `missing` when there is none, `undefined` when the id is unknown. */
  status(id: string): Promise<ContainerStatus | undefined>
  /**
   * Live usage of a running environment. `null` when it is not running (a stopped container has no reading),
   * `undefined` when the id is unknown: the caller answers 404 or 409 rather than zeros that suggest an idle box.
   */
  metrics(id: string): Promise<ContainerMetrics | null | undefined>
  /**
   * How to reach the container over SSH. `null` when it is not running or no port was published for it, which is the
   * answer for every container Cake creates today; `undefined` when the id is unknown.
   */
  ssh(id: string): Promise<SshAccessView | null | undefined>
  ofWorkspace(workspaceId: string): Promise<DevEnvironment[]>
  workspacesOf(environmentId: string): Promise<string[]>
  ofAgent(agentId: string): Promise<DevEnvironment | undefined>
  attach(workspaceId: string, environmentId: string): Promise<boolean>
  detach(workspaceId: string, environmentId: string): Promise<boolean>
  connectAgent(agentId: string, environmentId: string): Promise<void>
  disconnectAgent(agentId: string): Promise<boolean>
  /** The documents an environment bootstraps from, or `undefined` when the id is unknown. */
  manifest(id: string): Promise<EnvironmentManifest | undefined>
  /** Store a report from the container; `false` when the id is unknown. */
  recordState(id: string, state: unknown): Promise<boolean>
  state(id: string): Promise<ReportedState | undefined>
}

export const createEnvironmentApi = (options: EnvironmentApiOptions): EnvironmentApi => {
  const { environments, containers } = options

  // The container appends the environment's own paths, so one URL serves every environment this process provisions.
  const bootstrapEnv = (id: string): Readonly<Record<string, string>> =>
    options.backendUrl === null
      ? {}
      : {
          DEV_ENV_MANIFEST_URL: `${options.backendUrl}/environments/${id}/manifest`,
          DEV_ENV_STATE_URL: `${options.backendUrl}/environments/${id}/state`,
        }

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
        {
          id: environment.id,
          image: environment.image,
          env: bootstrapEnv(environment.id),
          network: options.network,
        },
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

    status: async (id) => {
      const environment = await environments.find(id)
      if (environment === undefined) return undefined
      // No container recorded means nothing was ever provisioned, so there is nothing for Docker to describe.
      if (environment.containerId === null) return 'missing'

      return containers.status(environment.containerId)
    },

    metrics: async (id) => {
      const environment = await environments.find(id)
      if (environment === undefined) return undefined
      if (environment.containerId === null) return null

      return containers.metrics(environment.containerId)
    },

    ssh: async (id) => {
      const environment = await environments.find(id)
      if (environment === undefined) return undefined
      if (environment.containerId === null) return null

      const endpoint = await containers.sshEndpoint(environment.containerId)

      return endpoint === null ? null : sshAccessOf(endpoint)
    },

    ofWorkspace: (workspaceId) => environments.ofWorkspace(workspaceId),
    workspacesOf: (environmentId) => environments.workspacesOf(environmentId),
    ofAgent: (agentId) => environments.ofAgent(agentId),
    attach: (workspaceId, environmentId) => environments.attach(workspaceId, environmentId),
    detach: (workspaceId, environmentId) => environments.detach(workspaceId, environmentId),
    connectAgent: (agentId, environmentId) => environments.connectAgent(agentId, environmentId),
    disconnectAgent: (agentId) => environments.disconnectAgent(agentId),
    recordState: (id, state) => environments.recordState(id, state),
    state: (id) => environments.reportedState(id),

    // The id is checked first: a manifest for an environment that does not exist is a 404, not an empty document.
    manifest: async (id) => (await environments.find(id)) === undefined ? undefined : buildManifest(options.secrets),
  }
}
