/**
 * How the backend reaches the Docker API: a socket on the host, or the read-write proxy in `deploy/compose.yaml`.
 *
 * Kept apart from `container-runtime.ts` so `config.ts` can validate the value without pulling `dockerode` into the
 * configuration module.
 */
export type DockerConnection =
  | { readonly socketPath: string }
  | { readonly host: string; readonly port: number }

const UNIX_PREFIX = 'unix://'
const TCP_PREFIX = 'tcp://'
const DEFAULT_TCP_PORT = 2375

/** The environment spelling dockerode expects in the stdio bridge process. */
export const dockerConnectionString = (connection: DockerConnection): string =>
  'socketPath' in connection
    ? `${UNIX_PREFIX}${connection.socketPath}`
    : `${TCP_PREFIX}${connection.host}:${connection.port}`

/** Parses `DOCKER_HOST`, or answers `undefined` when the value names neither a unix socket nor a tcp endpoint. */
export const parseDockerConnection = (value: string): DockerConnection | undefined => {
  if (value.startsWith(UNIX_PREFIX)) {
    const socketPath = value.slice(UNIX_PREFIX.length)

    return socketPath.startsWith('/') ? { socketPath } : undefined
  }

  if (value.startsWith(TCP_PREFIX)) {
    try {
      const url = new URL(value)
      const port = url.port === '' ? DEFAULT_TCP_PORT : Number(url.port)

      return url.hostname === '' || !Number.isInteger(port) ? undefined : { host: url.hostname, port }
    } catch {
      return undefined
    }
  }

  return undefined
}
