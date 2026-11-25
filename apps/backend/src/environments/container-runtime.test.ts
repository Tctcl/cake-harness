import { describe, expect, it } from 'vitest'

import type Docker from 'dockerode'

import { DockerContainers, readMetrics } from './container-runtime.js'
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
    // 200 CPU-units over 1000 of system time, on two cores, is 40% of the machine.
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
    const metrics = readMetrics(
      dockerSample({ memory_stats: { usage: 1000, limit: 4000, stats: { cache: 4000 } } }),
    )

    // Never negative: a cache larger than usage is a reading of itself, not a negative use.
    expect(metrics?.memoryUsedBytes).toBe(0)
  })

  it('answers a zero share when no CPU time elapsed between the samples', () => {
    const metrics = readMetrics(
      dockerSample({ precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 2000 } }),
    )

    // Two identical reads, or a sample with no predecessor to compare against: there is no share to divide out.
    expect(metrics?.cpuPercent).toBe(0)
  })

  it('counts one core when the daemon omits the core count', () => {
    const metrics = readMetrics(
      dockerSample({ cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2000 } }),
    )

    expect(metrics?.cpuPercent).toBe(20)
  })

  it('reports zeros for what a cgroup v2 host does not list', () => {
    const metrics = readMetrics(dockerSample({ blkio_stats: {}, networks: {} }))

    expect(metrics).toMatchObject({
      networkReceiveBytes: 0,
      networkTransmitBytes: 0,
      blockReadBytes: 0,
      blockWriteBytes: 0,
    })
  })

  it('parses the body when dockerode hands back the unparsed JSON', () => {
    expect(readMetrics(Buffer.from(JSON.stringify(dockerSample())))?.memoryLimitBytes).toBe(4000)
  })

  it('answers null when there is no sample in the answer', () => {
    expect(readMetrics(null)).toBeNull()
    // Docker's answer for a container that is not running.
    expect(readMetrics({})).toBeNull()
    expect(readMetrics('not json')).toBeNull()
  })
})

/** Docker's client rejects with the HTTP status on the error, the way dockerode's modem reports it. */
const dockerError = (statusCode: number): Error => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })

/**
 * A stand-in daemon that knows one container and records what was asked of it. Only the calls `ensureRunning` makes are
 * implemented; anything else would be a test asking about behaviour this suite does not cover.
 */
const fakeDaemon = (startFailure: Error | undefined) => {
  const calls = { started: [] as string[], created: [] as string[] }
  const daemon = {
    getContainer: (id: string) => ({
      start: async () => {
        calls.started.push(id)
        if (startFailure !== undefined) throw startFailure
      },
    }),
    createContainer: async (options: { name: string }) => {
      calls.created.push(options.name)
      return { id: 'created-id', start: async () => undefined }
    },
  }

  return { calls, docker: daemon as unknown as Docker }
}

const request: StartRequest = { id: 'env-1', image: 'cake-harness/dev-env:dev', env: {}, network: null }
const connection = { socketPath: '/var/run/docker.sock' } as const

describe('DockerContainers.ensureRunning', () => {
  it('starts the recorded container and keeps its id', async () => {
    const { calls, docker } = fakeDaemon(undefined)

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
    expect(calls.created).toEqual(['cake-env-env-1'])
  })

  it('reports any other refusal as unavailable rather than creating anything', async () => {
    const { calls, docker } = fakeDaemon(dockerError(500))

    await expect(new DockerContainers(connection, docker).ensureRunning(request, 'abc')).rejects.toMatchObject({
      statusCode: 503,
      code: 'ENVIRONMENT_UNAVAILABLE',
    })
    expect(calls.created).toEqual([])
  })
})
