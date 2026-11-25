import { Writable } from 'node:stream'

import type Docker from 'dockerode'

export interface ContainerExecResult {
  readonly exitCode: number
  readonly stdout: string
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

/** One non-interactive exec with optional stdin; the caller decides which command is safe to run. */
export const execInContainer = async (
  docker: Docker,
  containerId: string,
  Cmd: readonly string[],
  input?: Buffer,
): Promise<ContainerExecResult> => {
  const exec = await docker.getContainer(containerId).exec({
    Cmd: [...Cmd],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    // Key installation has to correct ownership even if a previous image left root-owned files behind.
    User: 'root',
    WorkingDir: '/home/dev/workspace',
  })
  const stream = await exec.start({ hijack: true, stdin: true, Tty: false })
  const stdout = collector()
  const stderr = collector()
  docker.modem.demuxStream(stream, stdout.stream, stderr.stream)
  const failed = new Promise<never>((_resolve, reject) => stream.once('error', reject))
  stream.end(input)

  const completed = async (): Promise<ContainerExecResult> => {
    for (;;) {
      const info = await exec.inspect()
      if (!info.Running) {
        return { exitCode: info.ExitCode ?? 0, stdout: stdout.text(), stderr: stderr.text() }
      }
      await pause()
    }
  }

  return Promise.race([completed(), failed])
}
