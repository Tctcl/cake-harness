import { describe, expect, it } from 'vitest'

import { noSecrets } from '../secrets/ciphergate.js'
import { createEnvironmentApi } from './api.js'
import type { ContainerRuntime, StartRequest } from './container-runtime.js'
import type { DevEnvironment, EnvironmentRepository } from './environment-repository.js'

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const ENVIRONMENT_ID = '5d4e3f60-7b8c-4d1e-9f2a-3b4c5d6e7f80'
const IMAGE = 'ghcr.io/tctcl/cake-harness/workspace:1.0.0'

const METRICS = {
  cpuPercent: 12.5,
  memoryUsedBytes: 1024,
  memoryLimitBytes: 4096,
  networkReceiveBytes: 1,
  networkTransmitBytes: 2,
  blockReadBytes: 3,
  blockWriteBytes: 4,
}

const environmentOf = (overrides: Partial<DevEnvironment> = {}): DevEnvironment => ({
  id: ENVIRONMENT_ID,
  name: 'Node',
  image: IMAGE,
  containerId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

/** Records the calls, so a test can assert the order the container and the row are touched in. */
const runtimeOf = (overrides: Partial<ContainerRuntime> = {}) => {
  const calls: string[] = []

  const runtime: ContainerRuntime = {
    ensureRunning: async (_request, containerId) => {
      calls.push(`ensureRunning:${containerId ?? 'none'}`)
      return 'created'
    },
    stop: async (containerId) => {
      calls.push(`stop:${containerId}`)
    },
    remove: async (containerId) => {
      calls.push(`remove:${containerId}`)
    },
    status: async (containerId) => {
      calls.push(`status:${containerId}`)

      return 'running'
    },
    metrics: async (containerId) => {
      calls.push(`metrics:${containerId}`)

      return METRICS
    },
    sshEndpoint: async (containerId) => {
      calls.push(`sshEndpoint:${containerId}`)

      return null
    },
    ...overrides,
  }

  return { runtime, calls }
}

/** Only the members the API reaches are answered; the rest fail loudly if it starts reaching them. */
const repositoryOf = (overrides: Partial<EnvironmentRepository> = {}): EnvironmentRepository =>
  ({
    list: async () => [],
    find: async () => undefined,
    create: async (_ownerId, input) => environmentOf({ name: input.name, image: input.image }),
    update: async () => undefined,
    setContainer: async (_id, containerId) => environmentOf({ containerId }),
    remove: async () => true,
    ...overrides,
  }) as EnvironmentRepository

describe('EnvironmentApi', () => {
  it('creates an environment from the configured image', async () => {
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf(),
      containers: runtimeOf().runtime,
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: null,
      network: null,
    })

    await expect(api.create('Go')).resolves.toMatchObject({ name: 'Go', image: IMAGE })
  })

  it('records the container id a start produced', async () => {
    const { runtime, calls } = runtimeOf()
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf({ find: async () => environmentOf() }),
      containers: runtime,
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: null,
      network: null,
    })

    const started = await api.start(ENVIRONMENT_ID)

    expect(started?.containerId).toBe('created')
    expect(calls).toEqual(['ensureRunning:none'])
  })

  it('removes the container before the row', async () => {
    const { runtime, calls } = runtimeOf()
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf({
        find: async () => environmentOf({ containerId: 'abc123' }),
        remove: async () => {
          calls.push('removeRow')
          return true
        },
      }),
      containers: runtime,
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: null,
      network: null,
    })

    await expect(api.remove(ENVIRONMENT_ID)).resolves.toBe(true)
    expect(calls).toEqual(['remove:abc123', 'removeRow'])
  })

  it('keeps the recorded id when a stop succeeds, so the next start reuses the container', async () => {
    const { runtime, calls } = runtimeOf()
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf({ find: async () => environmentOf({ containerId: 'abc123' }) }),
      containers: runtime,
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: null,
      network: null,
    })

    const stopped = await api.stop(ENVIRONMENT_ID)

    expect(stopped?.containerId).toBe('abc123')
    expect(calls).toEqual(['stop:abc123'])
  })

  it('answers undefined without touching Docker when the id is unknown', async () => {
    const { runtime, calls } = runtimeOf()
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf(),
      containers: runtime,
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: null,
      network: null,
    })

    await expect(api.start(ENVIRONMENT_ID)).resolves.toBeUndefined()
    await expect(api.stop(ENVIRONMENT_ID)).resolves.toBeUndefined()
    await expect(api.remove(ENVIRONMENT_ID)).resolves.toBe(false)
    await expect(api.status(ENVIRONMENT_ID)).resolves.toBeUndefined()
    await expect(api.metrics(ENVIRONMENT_ID)).resolves.toBeUndefined()
    await expect(api.ssh(ENVIRONMENT_ID)).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })

  it('asks Docker what the container is doing, because the row only records a name', async () => {
    const { runtime, calls } = runtimeOf()
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf({ find: async () => environmentOf({ containerId: 'abc123' }) }),
      containers: runtime,
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: null,
      network: null,
    })

    await expect(api.status(ENVIRONMENT_ID)).resolves.toBe('running')
    await expect(api.metrics(ENVIRONMENT_ID)).resolves.toEqual(METRICS)
    expect(calls).toEqual(['status:abc123', 'metrics:abc123'])
  })

  it('answers missing and no reading for an environment that never started, without asking Docker', async () => {
    const { runtime, calls } = runtimeOf()
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf({ find: async () => environmentOf() }),
      containers: runtime,
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: null,
      network: null,
    })

    await expect(api.status(ENVIRONMENT_ID)).resolves.toBe('missing')
    await expect(api.metrics(ENVIRONMENT_ID)).resolves.toBeNull()
    // Nothing was provisioned, so there is no container whose port could be published.
    await expect(api.ssh(ENVIRONMENT_ID)).resolves.toBeNull()
    expect(calls).toEqual([])
  })

  it('reports an SSH endpoint only when the container published one', async () => {
    const { runtime, calls } = runtimeOf({
      sshEndpoint: async (containerId) => {
        calls.push(`sshEndpoint:${containerId}`)

        return { host: '127.0.0.1', port: 2222 }
      },
    })
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf({ find: async () => environmentOf({ containerId: 'abc123' }) }),
      containers: runtime,
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: null,
      network: null,
    })

    await expect(api.ssh(ENVIRONMENT_ID)).resolves.toEqual({
      command: 'ssh -p 2222 dev@127.0.0.1',
      host: '127.0.0.1',
      port: 2222,
      user: 'dev',
    })
    expect(calls).toEqual(['sshEndpoint:abc123'])
  })

  it('tells the container where to fetch its documents', async () => {
    const requests: StartRequest[] = []
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf({
        find: async () => environmentOf(),
        setContainer: async (_id, containerId) => environmentOf({ containerId }),
      }),
      containers: {
        ...runtimeOf().runtime,
        ensureRunning: async (request) => {
          requests.push(request)
          return 'abc123'
        },
      },
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: 'http://backend:8080',
      network: 'cake-workspaces',
    })

    await api.start(ENVIRONMENT_ID)

    expect(requests[0]?.env).toEqual({
      DEV_ENV_MANIFEST_URL: `http://backend:8080/environments/${ENVIRONMENT_ID}/manifest`,
      DEV_ENV_STATE_URL: `http://backend:8080/environments/${ENVIRONMENT_ID}/state`,
    })
    expect(requests[0]?.network).toBe('cake-workspaces')
  })

  it('leaves the container without documents when no backend URL is configured', async () => {
    const requests: StartRequest[] = []
    const api = createEnvironmentApi({
      ownerId: OWNER_ID,
      environments: repositoryOf({
        find: async () => environmentOf(),
        setContainer: async (_id, containerId) => environmentOf({ containerId }),
      }),
      containers: {
        ...runtimeOf().runtime,
        ensureRunning: async (request) => {
          requests.push(request)
          return 'abc123'
        },
      },
      image: IMAGE,
      secrets: noSecrets,
      backendUrl: null,
      network: null,
    })

    await api.start(ENVIRONMENT_ID)

    expect(requests[0]?.env).toEqual({})
    expect(requests[0]?.network).toBeNull()
  })
})
