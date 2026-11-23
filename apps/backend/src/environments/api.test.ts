import { describe, expect, it } from 'vitest'

import { createEnvironmentApi } from './api.js'
import type { ContainerRuntime } from './container-runtime.js'
import type { DevEnvironment, EnvironmentRepository } from './environment-repository.js'

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const ENVIRONMENT_ID = '5d4e3f60-7b8c-4d1e-9f2a-3b4c5d6e7f80'
const IMAGE = 'ghcr.io/tctcl/tlabs-platform/workspace:1.0.0'

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
    })

    await expect(api.start(ENVIRONMENT_ID)).resolves.toBeUndefined()
    await expect(api.stop(ENVIRONMENT_ID)).resolves.toBeUndefined()
    await expect(api.remove(ENVIRONMENT_ID)).resolves.toBe(false)
    expect(calls).toEqual([])
  })
})
