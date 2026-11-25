import type { DockerConnection } from './docker-connection.js'

/**
 * How to reach a container's sshd. The dev image runs one on 22 for the `dev` user with public keys only
 * (`apps/agent/Dockerfile`, `apps/agent/docker/sshd_config`), so nothing here invents a service: it reports the mapping
 * Docker was asked for, and answers `null` when no port is published, which is the truth for a container the platform
 * created without one.
 */
export const SSH_USER = 'dev'

/** The port sshd listens on inside the image. The published host port is whatever Docker assigned. */
const CONTAINER_PORT = '22/tcp'

export interface SshEndpoint {
  readonly host: string
  readonly port: number
}

/** What the panel shows: the same endpoint, spelled out with the user and a command that can be pasted. */
export interface SshAccessView {
  readonly command: string
  readonly host: string
  readonly port: number
  readonly user: string
}

/**
 * The address a client should use for the Docker host: the daemon's own host when it runs over TCP, and loopback when
 * it is a local socket, because in that case the daemon is this machine.
 */
export const dockerHostOf = (connection: DockerConnection): string =>
  'socketPath' in connection ? '127.0.0.1' : connection.host

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

/**
 * Reads a container's SSH endpoint out of `docker inspect`. Only a running container has one: the mapping survives a
 * stop, but a command pointing at a closed port is worse than saying there is no access yet.
 */
export const readSshEndpoint = (inspected: unknown, host: string): SshEndpoint | null => {
  const container = object(inspected)
  if (container === undefined) return null

  const state = object(container['State'])
  if (state?.['Running'] !== true) return null

  const ports = object(object(container['NetworkSettings'])?.['Ports'])?.[CONTAINER_PORT]
  if (!Array.isArray(ports)) return null

  for (const binding of ports) {
    const port = Number(object(binding)?.['HostPort'])
    if (Number.isInteger(port) && port > 0) return { host, port }
  }

  return null
}

/** A copyable command, because what a person needs from this is the line they paste into a terminal. */
export const sshCommand = (endpoint: SshEndpoint): string =>
  `ssh -p ${endpoint.port} ${SSH_USER}@${endpoint.host}`

export const sshAccessOf = (endpoint: SshEndpoint): SshAccessView => ({
  command: sshCommand(endpoint),
  host: endpoint.host,
  port: endpoint.port,
  user: SSH_USER,
})
