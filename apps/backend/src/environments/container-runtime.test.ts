import { describe, expect, it } from 'vitest'

import type Docker from 'dockerode'

import { DockerContainers, environmentVolumeNames, readMetrics } from './container-runtime.js'
import type { StartRequest } from './container-runtime.js'

/** The shape Docker answers for `stats?stream=false`, trimmed to the fields the reading uses. */
const dockerSample = (overrides: Record<string, unknown> = {}) => ({
  cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2000, online_cpus: 2 },
  precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
  memory_stats: { usage: 1000, limit: 4000, stats: { cache: 250 } },
  networks: {
    eth0: { rx_bytes: 10, tx_bytes: 20 },
    eth1: { rx_bytes: 5, tx_bytes: 1 },
  },
  blkio_stats: {
    io_service_bytes_recursive: [
      { op: 'read', value: 7 },
      { op: 'write', value: 9 },
      { op: 'sync', value: 100 },
    ],
  },
  ...overrides,
})

describe('readMetrics', () => {
  it('reads one Docker sample as bytes and a CPU share', () => {
    expect(readMetrics(dockerSample())).toEqual({
      cpuPercent: 40,
      memoryUsedBytes: 750,
      memoryLimitBytes: 4000,
      networkReceiveBytes: 15,
      networkTransmitBytes: 21,
      blockReadBytes: 7,
      blockWriteBytes: 9,
    })
  })

  it('subtracts page cache, because a container that read a file has not used that memory', () => {
    const metrics = readMetrics(dockerSample({ memory_stats: { usage: 1000, limit: 4000, stats: { cache: 4000 } } }))
    expect(metrics?.memoryUsedBytes).toBe(0)
  })

  it('answers a zero share when no CPU time elapsed between the samples', () => {
    const metrics = readMetrics(
      dockerSample({ precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 2000 } }),
    )
    expect(metrics?.cpuPercent).toBe(0)
  })

  it('counts one core when the daemon omits the core count', () => {
    const metrics = readMetrics(dockerSample({ cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2000 } }))
    expect(metrics?.cpuPercent).toBe(20)
  })

  it('reports zeros for what a cgroup v2 host does not list', () => {
    const metrics = readMetrics(dockerSample({ blkio_stats: {}, networks: {} }))
    expect(metrics).toMatchObject({ networkReceiveBytes: 0, networkTransmitBytes: 0, blockReadBytes: 0, blockWriteBytes: 0 })
  })

  it('parses the body when dockerode hands back the unparsed JSON', () => {
    expect(readMetrics(Buffer.from(JSON.stringify(dockerSample())))?.memoryLimitBytes).toBe(4000)
  })

  it('answers null when there is no sample in the answer', () => {
    expect(readMetrics(null)).toBeNull()
    expect(readMetrics({})).toBeNull()
    expect(readMetrics('not json')).toBeNull()
  })
})

const dockerError = (statusCode: number): Error => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })
const request: StartRequest = { id: 'env-1', image: 'cake-harness/dev-env:dev', sshPort: 22_000, env: {}, network: null }
const connection = { socketPath: '/var/run/docker.sock' } as const

const expectedInspect = (): Docker.ContainerInspectInfo => ({
  Mounts: [
    { Type: 'volume', Name: 'cake-env-env-1-home', Destination: '/home/dev' },
    { Type: 'volume', Name: 'cake-env-env-1-ssh', Destination: '/var/lib/cake/ssh' },
  ],
  HostConfig: {
    PortBindings: { '22/tcp': [{ HostIp: '0.0.0.0', HostPort: '22000' }] },
  },
} as Docker.ContainerInspectInfo)

/** A stand-in daemon that records creation, lifecycle and volume calls without requiring a Docker socket. */
const fakeDaemon = (startFailure?: Error, inspected: Docker.ContainerInspectInfo = expectedInspect()) => {
  const calls = {
    started: [] as string[],
    created: [] as Docker.ContainerCreateOptions[],
    removedContainers: [] as string[],
    removedVolumes: [] as string[],
  }
  const existing = {
    inspect: async () => inspected,
    start: async () => {
      calls.started.push('abc')
      if (startFailure !== undefined) throw startFailure
    },
    remove: async () => {
      calls.removedContainers.push('abc')
    },
  }
  const daemon = {
    getContainer: (id: string) => id === 'abc' ? existing : {
      inspect: async () => { throw dockerError(404) },
      start: async () => { throw dockerError(404) },
    },
    createContainer: async (options: Docker.ContainerCreateOptions) => {
      calls.created.push(options)
      return { id: 'created-id', start: async () => undefined }
    },
    getVolume: (name: string) => ({
      remove: async () => {
        calls.removedVolumes.push(name)
      },
    }),
  }

  return { calls, docker: daemon as unknown as Docker }
}

describe('DockerContainers.ensureRunning', () => {
  it('starts a compatible recorded container and keeps its id', async () => {
    const { calls, docker } = fakeDaemon()
    await expect(new DockerContainers(connection, docker).ensureRunning(request, 'abc')).resolves.toBe('abc')
    expect(calls.created).toEqual([])
  })

  it('treats "already running" as success instead of creating a second container', async () => {
    const { calls, docker } = fakeDaemon(dockerError(304))
    await expect(new DockerContainers(connection, docker).ensureRunning(request, 'abc')).resolves.toBe('abc')
    expect(calls.created).toEqual([])
  })

  it('replaces a recorded container that Docker no longer has', async () => {
    const { calls, docker } = fakeDaemon(dockerError(404))
    await expect(new DockerContainers(connection, docker).ensureRunning(request, 'gone')).resolves.toBe('created-id')
    expect(calls.created[0]?.name).toBe('cake-env-env-1')
  })

  it('reports any other refusal as unavailable rather than creating anything', async () => {
    const { calls, docker } = fakeDaemon(dockerError(500))
    await expect(new DockerContainers(connection, docker).ensureRunning(request, 'abc')).rejects.toMatchObject({
      statusCode: 503,
      code: 'ENVIRONMENT_UNAVAILABLE',
    })
    expect(calls.created).toEqual([])
  })

  it('recreates an old container without the SSH layout and logs why', async () => {
    const old = { Mounts: [], HostConfig: {} } as unknown as Docker.ContainerInspectInfo
    const { calls, docker } = fakeDaemon(undefined, old)
    const warnings: string[] = []
    const containers = new DockerContainers(connection, docker, (message) => warnings.push(message))

    await expect(containers.ensureRunning(request, 'abc')).resolves.toBe('created-id')
    expect(calls.removedContainers).toEqual(['abc'])
    expect(calls.removedVolumes).toEqual([])
    expect(calls.created).toHaveLength(1)
    expect(warnings[0]).toContain('SSH mounts or port binding are outdated')
  })

  it('creates both persistent named volumes and publishes only the fixed SSH port', async () => {
    const { calls, docker } = fakeDaemon()
    await new DockerContainers(connection, docker).ensureRunning(request, null)

    expect(calls.created[0]).toMatchObject({
      ExposedPorts: { '22/tcp': {} },
      HostConfig: {
        Binds: ['cake-env-env-1-home:/home/dev', 'cake-env-env-1-ssh:/var/lib/cake/ssh'],
        PortBindings: { '22/tcp': [{ HostIp: '0.0.0.0', HostPort: '22000' }] },
      },
    })
    expect(environmentVolumeNames(request.id)).toEqual(['cake-env-env-1-home', 'cake-env-env-1-ssh'])
  })
})

describe('DockerContainers.remove', () => {
  it('removes the container and both volumes, including volumes when no container was recorded', async () => {
    const { calls, docker } = fakeDaemon()
    const containers = new DockerContainers(connection, docker)
    await containers.remove('abc', request.id)
    await containers.remove(null, request.id)

    expect(calls.removedContainers).toEqual(['abc'])
    expect(calls.removedVolumes).toEqual([
      ...environmentVolumeNames(request.id),
      ...environmentVolumeNames(request.id),
    ])
  })
})
