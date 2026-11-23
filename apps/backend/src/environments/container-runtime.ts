import Docker from 'dockerode'

import { AppError } from '../errors.js'
import type { DockerConnection } from './docker-connection.js'

/** What a container needs to know about the environment it runs. */
export interface StartRequest {
  readonly id: string
  readonly image: string
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
  /** Remove the container if it exists, and say nothing when it already is gone. */
  remove(containerId: string): Promise<void>
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

const containerName = (id: string): string => `tctcl-env-${id}`

/**
 * Provisions one environment as one container, through the read-write Docker proxy. The container carries labels, so
 * the platform can find what it created without this module remembering anything Docker already knows.
 */
export class DockerContainers implements ContainerRuntime {
  readonly #docker: Docker

  constructor(connection: DockerConnection) {
    this.#docker = new Docker(connection)
  }

  async ensureRunning(request: StartRequest, containerId: string | null): Promise<string> {
    if (containerId !== null) {
      try {
        await this.#docker.getContainer(containerId).start()
        return containerId
      } catch (error) {
        // A recorded container that Docker no longer has (a pruned host, a reinstall) is replaced below; anything
        // else is the daemon refusing, which the caller has to see.
        if (statusOf(error) !== 304 && statusOf(error) !== 404) throw unavailable('started', error)
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

  async remove(containerId: string): Promise<void> {
    try {
      // Forced: an environment is disposable, and a stuck process must not keep a deleted environment's container.
      await this.#docker.getContainer(containerId).remove({ force: true })
    } catch (error) {
      if (statusOf(error) === 404) return
      throw unavailable('removed', error)
    }
  }

  async #create(request: StartRequest): Promise<Docker.Container> {
    const options = {
      name: containerName(request.id),
      Image: request.image,
      Labels: {
        'tctcl.managed': 'true',
        'tctcl.environment': request.id,
      },
      Tty: false,
      HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
    } as const

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
