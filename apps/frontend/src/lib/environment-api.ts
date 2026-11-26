/**
 * The containers a workspace and an agent work in. An environment is its own row with an image and a container; a
 * workspace is attached to the ones it may use, and an agent holds at most one of them.
 */

import { request } from './http.ts'

export interface DevEnvironment {
  readonly id: string
  readonly name: string
  /** The image the container is created from, e.g. `node:26`. */
  readonly image: string
  /** The running container, or null until it is first started. */
  readonly containerId: string | null
  /** The stable host port assigned to this environment's SSH service. */
  readonly sshPort: number
  readonly createdAt: string
  readonly updatedAt: string
}

export type EnvironmentStatus = 'running' | 'restarting' | 'stopped' | 'missing'

export interface EnvironmentDetail extends DevEnvironment {
  readonly status: EnvironmentStatus
}

export interface ContainerMetrics {
  readonly cpuPercent: number
  readonly memoryUsedBytes: number
  readonly memoryLimitBytes: number
  readonly networkReceiveBytes: number
  readonly networkTransmitBytes: number
  readonly blockReadBytes: number
  readonly blockWriteBytes: number
}

export interface SshAccess {
  readonly command: string
  readonly host: string
  readonly port: number
  readonly user: string
  readonly running: boolean
}

export interface ListeningPort {
  readonly port: number
  readonly command: string
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** The environments the workspace is attached to — what its agents may be given. */
export const listWorkspaceEnvironments = async (workspaceId: string): Promise<DevEnvironment[]> =>
  (await request<{ environments: DevEnvironment[] }>(`/workspaces/${workspaceId}/environments`)).environments

/**
 * The environment a workspace runs in. A workspace is attached to a list, not to one container, so this is the first of
 * that list: the workspace manager shows one container, and choosing among several is not a control it offers yet.
 */
export const getWorkspaceEnvironment = async (workspaceId: string): Promise<DevEnvironment | null> =>
  (await listWorkspaceEnvironments(workspaceId))[0] ?? null

/**
 * Changing the image applies to the next start; a container already running keeps the image it was created from. Throws
 * when the workspace is attached to nothing, because there is no row to change.
 */
export const getEnvironment = async (environmentId: string): Promise<EnvironmentDetail> =>
  await request<EnvironmentDetail>(`/environments/${environmentId}`)

/** `null` means no endpoint was published; `running` separately reports the container state. */
export const getEnvironmentSsh = async (environmentId: string): Promise<SshAccess | null> =>
  await request<SshAccess | null>(`/environments/${environmentId}/ssh`)

/** One line of a container's output, as the backend's log stream sends it. */
export interface ContainerLogLine {
  readonly stream: 'stdout' | 'stderr'
  readonly at: string | null
  readonly text: string
}

/** Server-Sent Events: `line` per line (the recent tail first, then live), `end` once the container stops. */
export const environmentLogsPath = (environmentId: string): string => `/environments/${environmentId}/logs`

export const getEnvironmentPorts = async (environmentId: string): Promise<ListeningPort[]> =>
  (await request<{ ports: ListeningPort[] }>(`/environments/${environmentId}/ports`)).ports

export const setWorkspaceImage = async (workspaceId: string, image: string): Promise<DevEnvironment> => {
  const environment = await getWorkspaceEnvironment(workspaceId)
  if (environment === null) throw new Error('this workspace is attached to no environment')

  return await request<DevEnvironment>(`/environments/${environment.id}`, json('PATCH', { image }))
}

/** `null` is "no environment", which is a state of the agent rather than a missing resource. */
export const getAgentEnvironment = async (
  workspaceId: string,
  agentId: string,
): Promise<DevEnvironment | null> =>
  (await request<{ environment: DevEnvironment | null }>(`/workspaces/${workspaceId}/agents/${agentId}/environment`))
    .environment

export const connectAgentEnvironment = async (
  workspaceId: string,
  agentId: string,
  environmentId: string,
): Promise<DevEnvironment> =>
  (
    await request<{ environment: DevEnvironment }>(
      `/workspaces/${workspaceId}/agents/${agentId}/environment`,
      json('PUT', { environmentId }),
    )
  ).environment

export const disconnectAgentEnvironment = async (workspaceId: string, agentId: string): Promise<void> =>
  await request<void>(`/workspaces/${workspaceId}/agents/${agentId}/environment`, { method: 'DELETE' })

/** What a running container is using right now. `null` until the container has been sampled at least once. */
export interface EnvironmentStats {
  readonly cpuPercent: number
  readonly memoryUsed: number
  readonly memoryLimit: number
}

export const startEnvironment = async (environmentId: string): Promise<DevEnvironment> =>
  await request<DevEnvironment>(`/environments/${environmentId}/start`, { method: 'POST' })

export const stopEnvironment = async (environmentId: string): Promise<DevEnvironment> =>
  await request<DevEnvironment>(`/environments/${environmentId}/stop`, { method: 'POST' })

export const getEnvironmentMetrics = async (environmentId: string): Promise<ContainerMetrics> =>
  await request<ContainerMetrics>(`/environments/${environmentId}/metrics`)

export const getEnvironmentStats = async (environmentId: string): Promise<EnvironmentStats | null> => {
  // The compact conversation card predates the full metrics panel and uses only these three readings.
  const metrics = await getEnvironmentMetrics(environmentId)

  return {
    cpuPercent: metrics.cpuPercent,
    memoryUsed: metrics.memoryUsedBytes,
    memoryLimit: metrics.memoryLimitBytes,
  }
}
