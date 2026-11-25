import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Readable, Writable } from 'node:stream'

import Docker from 'dockerode'

export interface DaemonBridgeOptions {
  readonly argv: readonly string[]
  readonly docker: Docker
  readonly input: Readable
  readonly output: Writable
  readonly error: Writable
  readonly pollIntervalMs?: number
}

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolvePause) => setTimeout(resolvePause, milliseconds))

const execExit = async (exec: Docker.Exec, pollIntervalMs: number): Promise<number> => {
  for (;;) {
    const info = await exec.inspect()
    if (!info.Running) return info.ExitCode ?? 0
    await pause(pollIntervalMs)
  }
}

/**
 * Adapt docker exec's hijacked socket to the clean stdio Connection expects. Connection itself generates the token and
 * appends `serve --token <hex>` to this process's argv; the bridge only forwards that suffix to the deployed daemon.
 */
export const runDaemonBridge = async (options: DaemonBridgeOptions): Promise<number> => {
  const [containerId, daemonPath, serve, tokenFlag, token, ...extra] = options.argv
  if (
    containerId === undefined || daemonPath === undefined || serve !== 'serve' || tokenFlag !== '--token' ||
    token === undefined || !/^[\da-f]{32}$/.test(token) || extra.length > 0
  ) {
    throw new Error('usage: daemon-bridge <container-id> <daemon-path> serve --token <32 hex characters>')
  }

  const exec = await options.docker.getContainer(containerId).exec({
    Cmd: [daemonPath, serve, tokenFlag, token],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    User: 'dev',
    WorkingDir: '/home/dev/workspace',
  })
  const stream = await exec.start({ hijack: true, stdin: true, Tty: false })
  // Tty:false gives stdout and stderr separate Docker frames. pi-env's binary protocol must never see those headers.
  options.docker.modem.demuxStream(stream, options.output, options.error)
  options.input.pipe(stream)

  const failed = new Promise<never>((_resolve, reject) => {
    stream.once('error', reject)
    options.input.once('error', reject)
  })

  return Promise.race([execExit(exec, options.pollIntervalMs ?? 50), failed])
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  try {
    process.exitCode = await runDaemonBridge({
      argv: process.argv.slice(2),
      // dockerode reads DOCKER_HOST here. The backend sets it from its validated config before spawning the bridge.
      docker: new Docker(),
      input: process.stdin,
      output: process.stdout,
      error: process.stderr,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`pi-env bridge failed: ${message}\n`)
    process.exitCode = 1
  }
}
