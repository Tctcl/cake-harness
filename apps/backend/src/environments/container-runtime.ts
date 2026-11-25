import Docker from 'dockerode'

import { AppError } from '../errors.js'
import { execInContainer } from './container-exec.js'
import type { DockerConnection } from './docker-connection.js'
import { parseListeningPorts } from './listening-ports.js'
import type { SshEndpoint } from './ssh-access.js'
import { dockerHostOf, readSshEndpoint } from './ssh-access.js'

/** What a container needs to know about the environment it runs. */
export interface StartRequest {
  readonly id: string
  readonly image: string
  /** The stable host port that publishes container port 22. */
  readonly sshPort: number
  /** Variables the container boots with; empty when Cake has nothing to tell it. */
  readonly env: Readonly<Record<string, string>>
  /** The network the backend is reachable on, or `null` to leave the container on Docker's default one. */
  readonly network: string | null
}

/**
 * The Docker operations one environment needs. An interface rather than the client itself, so a route test exercises
 * the decisions — create when there is no container, reuse one that exists — without a Docker daemon.
 */
export interface ContainerRuntime {
  /** Answer the running container's id, creating it from `image` first when `containerId` is absent or vanished. */
  ensureRunning(request: StartRequest, containerId: string | null): Promise<string>
  /** Stop the container if it exists, and say nothing when it already is. */
  stop(containerId: string): Promise<void>
  /** Remove the container and both environment volumes; a null id still removes orphaned volumes. */
  remove(containerId: string | null, environmentId: string): Promise<void>
  /** Ask Docker what the container is doing now, so a status is a fact rather than a recorded id. */
  status(containerId: string): Promise<ContainerStatus>
  /** One sample of the container's use, or `null` when Docker has none because it is not running. */
  metrics(containerId: string): Promise<ContainerMetrics | null>
  /** Replace the owner's complete authorized_keys file, including with an empty file when the last key is deleted. */
  replaceAuthorizedKeys(containerId: string, publicKeys: readonly string[]): Promise<void>
  /** Listening TCP ports inside a running container, read without installing another process in the image. */
  listeningPorts(containerId: string): Promise<readonly number[]>
  /**
   * Where the container's sshd can be reached, or `null` when it is not running or no port was published for it.
   * Nothing here opens a port: it reports the mapping Docker was asked for.
   */
  sshEndpoint(containerId: string): Promise<SshEndpoint | null>
}

/** Docker's own view of a container. `missing` also answers for an environment that never started, which is true. */
export const containerStatuses = ['running', 'stopped', 'missing'] as const
export type ContainerStatus = (typeof containerStatuses)[number]

/** One reading of a running container, in base units: nothing here agrees with a human about megabytes. */
export interface ContainerMetrics {
  readonly cpuPercent: number
  readonly memoryUsedBytes: number
  readonly memoryLimitBytes: number
  readonly networkReceiveBytes: number
  readonly networkTransmitBytes: number
  readonly blockReadBytes: number
  readonly blockWriteBytes: number
}

/** Docker answers 404 for a container that is not there; that is a state this module handles, not a failure. */
const statusOf = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined

  return typeof error.statusCode === 'number' ? error.statusCode : undefined
}

const unavailable = (action: string, error: unknown): AppError => {
  const reason = error instanceof Error ? error.message : String(error)

  return new AppError(`the environment could not be ${action}: ${reason}`, {
    statusCode: 503,
    code: 'ENVIRONMENT_UNAVAILABLE',
  })
}

const containerName = (id: string): string => `cake-env-${id}`

export const environmentVolumeNames = (id: string): readonly [string, string] => [
  `cake-env-${id}-home`,
  `cake-env-${id}-ssh`,
]

const SSH_CONTAINER_PORT = '22/tcp'

/** A pre-SSH container cannot acquire a port or mounts by being restarted; it is replaced while its named volumes remain. */
const hasExpectedLayout = (inspected: Docker.ContainerInspectInfo, request: StartRequest): boolean => {
  const [home, hostKeys] = environmentVolumeNames(request.id)
  const mounts = inspected.Mounts ?? []
  const mounted = (name: string, destination: string): boolean =>
    mounts.some((mount) => mount.Type === 'volume' && mount.Name === name && mount.Destination === destination)
  const binding = inspected.HostConfig?.PortBindings?.[SSH_CONTAINER_PORT]?.[0]

  return mounted(home, '/home/dev') && mounted(hostKeys, '/var/lib/cake/ssh') &&
    binding?.HostPort === String(request.sshPort) &&
    (binding.HostIp === '0.0.0.0' || binding.HostIp === '')
}

/**
 * Provisions one environment as one container, through the read-write Docker proxy. The container carries labels, so
 * Cake can find what it created without this module remembering anything Docker already knows.
 */
export class DockerContainers implements ContainerRuntime {
  readonly #docker: Docker
  readonly #host: string
  readonly #warn: (message: string) => void

  // The client is a parameter so a test can hand in a stand-in daemon; production always builds it from the connection.
  constructor(
    connection: DockerConnection,
    docker: Docker = new Docker(connection),
    warn: (message: string) => void = (message) => process.emitWarning(message, { code: 'CAKE_CONTAINER_RECREATED' }),
  ) {
    this.#docker = docker
    // Derived once: the daemon's address does not change for the life of the process.
    this.#host = dockerHostOf(connection)
    this.#warn = warn
  }

  async ensureRunning(request: StartRequest, containerId: string | null): Promise<string> {
    if (containerId !== null) {
      const existing = this.#docker.getContainer(containerId)
      try {
        const inspected = await existing.inspect()
        if (hasExpectedLayout(inspected, request)) {
          await existing.start()
          return containerId
        }

        this.#warn(`Recreating ${containerId} for environment ${request.id}: its SSH mounts or port binding are outdated`)
        await existing.remove({ force: true })
      } catch (error) {
        // 304 is Docker saying the container is already running, which is the state this call is for.
        if (statusOf(error) === 304) return containerId
        // A recorded container that Docker no longer has (a pruned host, a reinstall) is replaced below; anything
        // else is the daemon refusing, which the caller has to see.
        if (statusOf(error) !== 404) throw unavailable('started', error)
      }
    }

    const created = await this.#create(request)

    return created.id
  }

  async stop(containerId: string): Promise<void> {
    try {
      await this.#docker.getContainer(containerId).stop()
    } catch (error) {
      if (statusOf(error) === 304 || statusOf(error) === 404) return
      throw unavailable('stopped', error)
    }
  }

  async remove(containerId: string | null, environmentId: string): Promise<void> {
    if (containerId !== null) {
      try {
        // Forced: an environment is disposable, and a stuck process must not keep its container behind.
        await this.#docker.getContainer(containerId).remove({ force: true })
      } catch (error) {
        if (statusOf(error) !== 404) throw unavailable('removed', error)
      }
    }

    for (const name of environmentVolumeNames(environmentId)) {
      try {
        await this.#docker.getVolume(name).remove()
      } catch (error) {
        if (statusOf(error) !== 404) throw unavailable('removed', error)
      }
    }
  }

  async status(containerId: string): Promise<ContainerStatus> {
    try {
      const inspected = await this.#docker.getContainer(containerId).inspect()

      return inspected.State.Running ? 'running' : 'stopped'
    } catch (error) {
      // A container Docker does not have is the state a prune or a host reinstall leaves behind, not a failure.
      if (statusOf(error) === 404) return 'missing'
      throw unavailable('inspected', error)
    }
  }

  async metrics(containerId: string): Promise<ContainerMetrics | null> {
    try {
      const sample = await this.#docker.getContainer(containerId).stats({ stream: false })

      return readMetrics(sample)
    } catch (error) {
      // Docker refuses a sample for a container that is not running; that is an answer, not a failure.
      if (statusOf(error) === 409 || statusOf(error) === 404) return null
      throw unavailable('measured', error)
    }
  }

  async replaceAuthorizedKeys(containerId: string, publicKeys: readonly string[]): Promise<void> {
    const command = 'install -d -m 0700 -o dev -g dev /home/dev/.ssh && ' +
      'cat > /home/dev/.ssh/authorized_keys && ' +
      'chown dev:dev /home/dev/.ssh/authorized_keys && chmod 0600 /home/dev/.ssh/authorized_keys'
    const input = Buffer.from(publicKeys.length === 0 ? '' : `${publicKeys.join('\n')}\n`, 'utf8')
    const result = await execInContainer(this.#docker, containerId, ['sh', '-c', command], input)
    if (result.exitCode !== 0) {
      throw unavailable('given its SSH keys', new Error(result.stderr.trim() || `exec exited ${result.exitCode}`))
    }
  }

  async listeningPorts(containerId: string): Promise<readonly number[]> {
    const result = await execInContainer(this.#docker, containerId, ['cat', '/proc/net/tcp', '/proc/net/tcp6'])
    if (result.exitCode !== 0) {
      throw unavailable('inspected for listening ports', new Error(result.stderr.trim() || `exec exited ${result.exitCode}`))
    }

    return parseListeningPorts(result.stdout)
  }

  async sshEndpoint(containerId: string): Promise<SshEndpoint | null> {
    try {
      const inspected = await this.#docker.getContainer(containerId).inspect()

      return readSshEndpoint(inspected, this.#host)
    } catch (error) {
      // A container that is gone has no endpoint; asking again after a start is cheaper than caching the answer.
      if (statusOf(error) === 404) return null
      throw unavailable('inspected', error)
    }
  }

  async #create(request: StartRequest): Promise<Docker.Container> {
    const options = {
      name: containerName(request.id),
      Image: request.image,
      // Docker reads this as `NAME=value` pairs; nothing here is read back by Cake.
      Env: Object.entries(request.env).map(([name, value]) => `${name}=${value}`),
      Labels: {
        'cake.managed': 'true',
        'cake.environment': request.id,
      },
      Tty: false,
      ExposedPorts: { [SSH_CONTAINER_PORT]: {} },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: (() => {
          const [home, hostKeys] = environmentVolumeNames(request.id)
          return [`${home}:/home/dev`, `${hostKeys}:/var/lib/cake/ssh`]
        })(),
        PortBindings: {
          [SSH_CONTAINER_PORT]: [{ HostIp: '0.0.0.0', HostPort: String(request.sshPort) }],
        },
        // Without this the container cannot resolve `backend`, and a boot would fail on a manifest it cannot reach.
        ...(request.network === null ? {} : { NetworkMode: request.network }),
      },
    }

    let container: Docker.Container
    try {
      container = await this.#docker.createContainer(options)
    } catch (error) {
      // The first start on a fresh host is the common case: pull the image once rather than making the operator do it.
      if (statusOf(error) !== 404) throw unavailable('created', error)
      await this.#pull(request.image)
      container = await this.#docker.createContainer(options)
    }

    try {
      await container.start()
    } catch (error) {
      throw unavailable('started', error)
    }

    return container
  }

  async #pull(image: string): Promise<void> {
    try {
      const stream = await this.#docker.pull(image)
      await new Promise<void>((resolve, reject) => {
        this.#docker.modem.followProgress(stream, (error: Error | null) => {
          if (error === null) resolve()
          else reject(error)
        })
      })
    } catch (error) {
      throw unavailable('pulled', error)
    }
  }
}

const fieldsOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? Object.fromEntries(Object.entries(value)) : undefined

/**
 * A field Docker did not send is a zero, not a failure: cgroup v2 omits block I/O entirely, and a container with no
 * traffic has no interfaces to count.
 */
const countAt = (source: unknown, ...path: readonly string[]): number => {
  let current: unknown = source

  for (const key of path) current = fieldsOf(current)?.[key]

  return typeof current === 'number' && Number.isFinite(current) ? current : 0
}

/** Sums a field across whatever `entries` lists — interfaces, block devices — one entry at a time. */
const sumOf = (entries: unknown, pick: (entry: unknown) => number): number => {
  const fields = fieldsOf(entries)
  if (fields === undefined) return 0

  return Object.values(fields).reduce<number>((total, entry) => total + pick(entry), 0)
}

const blockBytesOf = (stats: Record<string, unknown>, op: 'read' | 'write'): number =>
  sumOf(fieldsOf(stats['blkio_stats'])?.['io_service_bytes_recursive'], (entry) =>
    fieldsOf(entry)?.['op'] === op ? countAt(entry, 'value') : 0,
  )

/**
 * The counters Docker reports are cumulative, so the share is the delta since the previous sample over the CPU time
 * that elapsed — `online_cpus` twice because a share of one core is not a share of the machine.
 */
const cpuPercentOf = (stats: Record<string, unknown>): number => {
  const used = countAt(stats, 'cpu_stats', 'cpu_usage', 'total_usage') - countAt(stats, 'precpu_stats', 'cpu_usage', 'total_usage')
  const elapsed = countAt(stats, 'cpu_stats', 'system_cpu_usage') - countAt(stats, 'precpu_stats', 'system_cpu_usage')
  const cpus = Math.max(countAt(stats, 'cpu_stats', 'online_cpus'), 1)

  // A first sample has nothing to compare against, and a stale `precpu_stats` gives a non-positive delta.
  if (elapsed <= 0) return 0

  return Math.round((Math.max(used, 0) / elapsed) * cpus * 10_000) / 100
}

/**
 * Docker's stats body, narrowed. `memory.usage` counts page cache, which `docker stats` subtracts: a container that has
 * read a file has not therefore used that memory, and reporting it as if it had reads as a leak in the panel.
 */
export const readMetrics = (sample: unknown): ContainerMetrics | null => {
  const stats = statsOf(sample)
  if (stats === undefined) return null

  // Docker answers `{}` for a container that is not running; there is no sample in it to report.
  if (stats['cpu_stats'] === undefined && stats['memory_stats'] === undefined) return null

  const memory = fieldsOf(stats['memory_stats'])
  const usage = countAt(memory, 'usage')
  const cached = countAt(memory, 'stats', 'cache')

  return {
    cpuPercent: cpuPercentOf(stats),
    memoryUsedBytes: Math.max(usage - cached, 0),
    memoryLimitBytes: countAt(memory, 'limit'),
    networkReceiveBytes: sumOf(stats['networks'], (entry) => countAt(entry, 'rx_bytes')),
    networkTransmitBytes: sumOf(stats['networks'], (entry) => countAt(entry, 'tx_bytes')),
    blockReadBytes: blockBytesOf(stats, 'read'),
    blockWriteBytes: blockBytesOf(stats, 'write'),
  }
}

/** Docker's body as a field map. dockerode parses a single sample; a buffer that never got parsed is the same JSON. */
const statsOf = (sample: unknown): Record<string, unknown> | undefined => {
  const decoded = Buffer.isBuffer(sample) ? sample.toString('utf8') : sample
  if (typeof decoded !== 'string') return fieldsOf(decoded)

  try {
    return fieldsOf(JSON.parse(decoded))
  } catch {
    // Docker answered with something that is not a sample, so there is no reading to report.
    return undefined
  }
}
