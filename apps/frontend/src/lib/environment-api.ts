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
  readonly createdAt: string
  readonly updatedAt: string
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

/** The same reading as the backend reports it: byte counts, plus the counters this panel leaves out. */
interface ContainerMetrics {
  readonly cpuPercent: number
  readonly memoryUsedBytes: number
  readonly memoryLimitBytes: number
}

export const startEnvironment = async (environmentId: string): Promise<DevEnvironment> =>
  await request<DevEnvironment>(`/environments/${environmentId}/start`, { method: 'POST' })

export const stopEnvironment = async (environmentId: string): Promise<DevEnvironment> =>
  await request<DevEnvironment>(`/environments/${environmentId}/stop`, { method: 'POST' })

export const getEnvironmentStats = async (environmentId: string): Promise<EnvironmentStats | null> => {
  // The route is `/metrics` and it reports bytes and more counters than the panel shows; the reading is renamed here so
  // the component is not coupled to the wire names.
  const metrics = await request<ContainerMetrics>(`/environments/${environmentId}/metrics`)

  return {
    cpuPercent: metrics.cpuPercent,
    memoryUsed: metrics.memoryUsedBytes,
    memoryLimit: metrics.memoryLimitBytes,
  }
}
