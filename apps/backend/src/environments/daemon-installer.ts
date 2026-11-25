import { readFile } from 'node:fs/promises'
import { Writable } from 'node:stream'

import { packagedDaemon } from '@earendil-works/pi-env'
import Docker from 'dockerode'

import type { DockerConnection } from './docker-connection.js'

export const PI_ENV_VERSION = '1.6.0'
export const PI_ENV_DAEMON_PATH = `/home/dev/.local/share/tlabs/pi-env-${PI_ENV_VERSION}`
const DAEMON_DIRECTORY = '/home/dev/.local/share/tlabs'

export interface DaemonInstaller {
  ensure(containerId: string): Promise<string>
}

export const daemonArchitecture = (
  inspected: string | undefined,
  fallback: NodeJS.Architecture = process.arch,
): 'x64' | 'arm64' => {
  if (inspected === 'amd64') return 'x64'
  if (inspected === 'arm64') return 'arm64'
  if (fallback === 'x64' || fallback === 'arm64') return fallback

  throw new Error(`no pi-env daemon is available for container architecture ${inspected ?? fallback}`)
}

interface ExecResult {
  readonly exitCode: number
  readonly stderr: string
}

const collector = (): { readonly stream: Writable; readonly text: () => string } => {
  const chunks: Buffer[] = []
  const stream = new Writable({
    write(chunk: unknown, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      callback()
    },
  })

  return { stream, text: () => Buffer.concat(chunks).toString('utf8') }
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25))

/** Uploads the package's own binary without adding anything to the workspace image or opening a network listener. */
export class DockerDaemonInstaller implements DaemonInstaller {
  readonly #docker: Docker

  constructor(connection: DockerConnection, docker: Docker = new Docker(connection)) {
    this.#docker = docker
  }

  async ensure(containerId: string): Promise<string> {
    const container = this.#docker.getContainer(containerId)
    const inspected = await container.inspect()
    const image = await this.#docker.getImage(inspected.Image).inspect()
    const arch = daemonArchitecture(image.Architecture)
    const present = await this.#run(container, ['test', '-x', PI_ENV_DAEMON_PATH])
    if (present.exitCode === 0) return PI_ENV_DAEMON_PATH

    const binary = await readFile(packagedDaemon({ platform: 'linux', arch }))
    // The versioned destination is replaced only after a complete upload; a killed connection leaves a .tmp file instead.
    const command = `mkdir -p ${DAEMON_DIRECTORY} && cat > ${PI_ENV_DAEMON_PATH}.tmp && chmod 0755 ${PI_ENV_DAEMON_PATH}.tmp && mv ${PI_ENV_DAEMON_PATH}.tmp ${PI_ENV_DAEMON_PATH}`
    const installed = await this.#run(container, ['sh', '-c', command], binary)
    if (installed.exitCode !== 0) {
      throw new Error(`could not install pi-env in ${containerId} (exit ${installed.exitCode}): ${installed.stderr.trim()}`)
    }

    return PI_ENV_DAEMON_PATH
  }

  async #run(container: Docker.Container, Cmd: readonly string[], input?: Buffer): Promise<ExecResult> {
    const exec = await container.exec({
      Cmd: [...Cmd],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: 'dev',
      WorkingDir: '/home/dev/workspace',
    })
    const stream = await exec.start({ hijack: true, stdin: true, Tty: false })
    const stdout = collector()
    const stderr = collector()
    this.#docker.modem.demuxStream(stream, stdout.stream, stderr.stream)
    const failed = new Promise<never>((_resolve, reject) => stream.once('error', reject))
    stream.end(input)

    const completed = async (): Promise<ExecResult> => {
      for (;;) {
        const info = await exec.inspect()
        if (!info.Running) return { exitCode: info.ExitCode ?? 0, stderr: stderr.text() }
        await pause()
      }
    }

    return Promise.race([completed(), failed])
  }
}
