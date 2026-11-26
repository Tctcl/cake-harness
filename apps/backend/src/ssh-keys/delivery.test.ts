import { describe, expect, it } from 'vitest'

import type { DevEnvironment } from '../environments/environment-repository.js'
import { createAuthorizedKeyDelivery } from './delivery.js'
import type { SshKeyStore } from './ssh-key-repository.js'

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const PUBLIC_KEYS = ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHJPOdiu8Ol2WKBKTzIV+JvRpeQbODlBw8uQpa+7VXVs']

const environment = (id: string, containerId: string | null): DevEnvironment => ({
  id,
  name: id,
  image: 'cake-harness/dev-env:dev',
  tooling: [],
  containerId,
  sshPort: 22_000,
  createdAt: new Date(0),
  updatedAt: new Date(0),
})

describe('authorized key delivery', () => {
  it('writes the complete owner key list to each running container and skips stopped or uncreated ones', async () => {
    const writes: { containerId: string; keys: readonly string[] }[] = []
    const keys: SshKeyStore = {
      list: async () => [],
      publicKeys: async () => PUBLIC_KEYS,
      create: async () => { throw new Error('not used') },
      remove: async () => false,
    }
    const deliver = createAuthorizedKeyDelivery({
      ownerId: OWNER_ID,
      keys,
      environments: {
        list: async () => [
          environment('running', 'running-id'),
          environment('stopped', 'stopped-id'),
          environment('uncreated', null),
        ],
      },
      containers: {
        status: async (containerId) => containerId === 'running-id' ? 'running' : 'stopped',
        replaceAuthorizedKeys: async (containerId, publicKeys) => {
          writes.push({ containerId, keys: publicKeys })
        },
      },
    })

    await deliver()
    expect(writes).toEqual([{ containerId: 'running-id', keys: PUBLIC_KEYS }])
  })

  it('sends an empty list after the last key is removed', async () => {
    const writes: (readonly string[])[] = []
    const keys: SshKeyStore = {
      list: async () => [],
      publicKeys: async () => [],
      create: async () => { throw new Error('not used') },
      remove: async () => false,
    }
    const deliver = createAuthorizedKeyDelivery({
      ownerId: OWNER_ID,
      keys,
      environments: { list: async () => [environment('running', 'container-id')] },
      containers: {
        status: async () => 'running',
        replaceAuthorizedKeys: async (_containerId, publicKeys) => {
          writes.push(publicKeys)
        },
      },
    })

    await deliver()
    expect(writes).toEqual([[]])
  })

  it('reports a container that cannot take the keys and still writes the others', async () => {
    const writes: string[] = []
    const failures: string[] = []
    const keys: SshKeyStore = {
      list: async () => [],
      publicKeys: async () => PUBLIC_KEYS,
      create: async () => { throw new Error('not used') },
      remove: async () => false,
    }
    const deliver = createAuthorizedKeyDelivery({
      ownerId: OWNER_ID,
      keys,
      environments: {
        list: async () => [environment('restarting', 'restarting-id'), environment('healthy', 'healthy-id')],
      },
      containers: {
        status: async () => 'running',
        replaceAuthorizedKeys: async (containerId) => {
          // Docker's answer for a container in a restart loop, as seen on staging.
          if (containerId === 'restarting-id') throw new Error('(HTTP code 409) container is restarting')
          writes.push(containerId)
        },
      },
      onFailure: (environmentId) => {
        failures.push(environmentId)
      },
    })

    await expect(deliver()).resolves.toBeUndefined()
    expect(writes).toEqual(['healthy-id'])
    expect(failures).toEqual(['restarting'])
  })
})
