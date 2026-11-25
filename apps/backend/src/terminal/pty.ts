import Docker from 'dockerode'

import type { DockerConnection } from '../environments/docker-connection.js'
import { AppError } from '../errors.js'
import type { TerminalSize } from './contract.js'

export interface PtyExit {
  readonly code: number | null
  readonly signal: string | null
}

/**
 * One program in a container, seen as bytes in and bytes out. The interface exists so the session bookkeeping can be
 * tested against a fake: a real PTY needs a container, and a route test must not.
 */
export interface Pty {
  onData(listener: (chunk: Buffer) => void): void
  onExit(listener: (exit: PtyExit) => void): void
  /** False once the program stopped reading, which is the caller's cue that nothing more will reach it. */
  write(bytes: Uint8Array): boolean
  resize(size: TerminalSize): void
  /** Ends the program and resolves only when it is gone, escalating from EOF to signals rather than reporting success. */
  kill(): Promise<void>
}

export interface PtyOpenRequest {
  readonly containerId: string
  readonly size: TerminalSize
  readonly command: readonly string[]
}

export interface PtyFactory {
  open(request: PtyOpenRequest): Promise<Pty>
}

/** Docker's own answer for "the container is not running": the environment exists, it is just not started. */
const stoppedStatuses = new Set([404, 409])

const statusOf = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined

  return typeof error.statusCode === 'number' ? error.statusCode : undefined
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The duplex stream dockerode hands back from a hijacked `exec` start. Narrowed structurally because the client's
 * own type for it is untyped, and a cast to `any` is not available to us.
 */
interface PtyStream {
  on(event: 'data', listener: (chunk: Buffer) => void): void
  on(event: 'end' | 'close', listener: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
  write(bytes: Uint8Array): boolean
  end(): void
  destroy(): void
}

const asStream = (value: unknown): PtyStream | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { on?: unknown; end?: unknown }
  if (typeof candidate.on !== 'function' || typeof candidate.end !== 'function') return undefined

  return value as PtyStream
}

/** Polls the exec rather than waiting on a socket event: `end` also fires on a dropped connection, not only an exit. */
const waitForStop = async (exec: Docker.Exec, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const info = await exec.inspect()
      if (!info.Running) return true
    } catch {
      // The exec record vanished (a container removal): nothing is left to wait for.
      return true
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/**
 * Provisions terminals as `docker exec` sessions inside an environment's container.
 *
 * `Tty: true` is what makes this a terminal rather than a pipe: Docker allocates a PTY, programs see `isatty` and
 * send their own escape sequences, and the stream is unframed — no multiplexing header to parse.
 */
export class DockerPtys implements PtyFactory {
  readonly #docker: Docker

  constructor(connection: DockerConnection) {
    this.#docker = new Docker(connection)
  }

  async open(request: PtyOpenRequest): Promise<Pty> {
    const container = this.#docker.getContainer(request.containerId)

    let exec: Docker.Exec
    try {
      exec = await container.exec({
        Cmd: [...request.command],
        // Attached on all three: a TTY merges stderr into stdout, and a client that cannot write has no shell.
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: ['TERM=xterm-256color', 'COLORTERM=truecolor'],
      })
    } catch (error) {
      throw this.#failure('opened', error)
    }

    let stream: PtyStream | undefined
    try {
      stream = asStream(await exec.start({ hijack: true, stdin: true, Tty: true }))
    } catch (error) {
      throw this.#failure('opened', error)
    }
    if (stream === undefined) {
      throw new AppError('the terminal could not be opened: docker returned no stream', {
        statusCode: 503,
        code: 'ENVIRONMENT_UNAVAILABLE',
      })
    }

    // Before the first read: a program that asks for the window size during startup gets a sane answer.
    await exec.resize({ w: request.size.cols, h: request.size.rows }).catch(() => undefined)

    return new DockerPty(container, exec, stream)
  }

  #failure(action: string, error: unknown): AppError {
    const status = statusOf(error)
    if (status !== undefined && stoppedStatuses.has(status)) {
      return new AppError('the environment is not running', { statusCode: 409, code: 'ENVIRONMENT_STOPPED' })
    }

    return new AppError(`the terminal could not be ${action}: ${reason(error)}`, {
      statusCode: 503,
      code: 'ENVIRONMENT_UNAVAILABLE',
    })
  }
}

interface ExitListener {
  (exit: PtyExit): void
}

class DockerPty implements Pty {
  readonly #container: Docker.Container
  readonly #exec: Docker.Exec
  readonly #stream: PtyStream
  readonly #exits = new Set<ExitListener>()
  #ended = false
  #exitCode: number | null = null

  constructor(container: Docker.Container, exec: Docker.Exec, stream: PtyStream) {
    this.#container = container
    this.#exec = exec
    this.#stream = stream

    stream.on('data', () => undefined)
    stream.on('end', () => void this.#finish(null))
    stream.on('close', () => void this.#finish(null))
    stream.on('error', () => void this.#finish(null))
  }

  onData(listener: (chunk: Buffer) => void): void {
    this.#stream.on('data', listener)
  }

  onExit(listener: ExitListener): void {
    this.#exits.add(listener)
    if (this.#ended) listener({ code: this.#exitCode, signal: null })
  }

  write(bytes: Uint8Array): boolean {
    if (this.#ended) return false
    // Written raw: the bytes are the program's input, and re-encoding them would turn a control character into text.
    this.#stream.write(bytes)

    return true
  }

  resize(size: TerminalSize): void {
    // Fire and forget: a resize that loses a race with the program exiting is not worth failing a request over.
    void this.#exec.resize({ w: size.cols, h: size.rows }).catch(() => undefined)
  }

  async kill(): Promise<void> {
    // EOF first, which is what a shell reads as "leave": most sessions end here, with no signal at all.
    try {
      this.#stream.end()
    } catch {
      // Already ended by the program; the escalation below still has to check whether anything is running.
    }

    if (await waitForStop(this.#exec, 250)) {
      await this.#finish(this.#exitCode)
      return
    }

    const pid = await this.#pid()
    if (pid !== undefined) {
      await this.#signal(pid, 'TERM')
      if (!(await waitForStop(this.#exec, 1000))) {
        await this.#signal(pid, 'KILL')
        await waitForStop(this.#exec, 500)
      }
    }

    this.#stream.destroy()
    await this.#finish(this.#exitCode)
  }

  async #pid(): Promise<number | undefined> {
    try {
      const info = await this.#exec.inspect()
      // A stopped exec still reports the pid it had; only a running one is worth signalling.
      return info.Running && typeof info.Pid === 'number' ? info.Pid : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Signals the process group, not the process: `docker exec` runs the command as a session leader, so a shell's
   * children share its id — killing only the shell would leave a build running in a session nobody can reach.
   */
  async #signal(pid: number, signal: 'TERM' | 'KILL'): Promise<void> {
    try {
      const exec = await this.#container.exec({
        Cmd: ['sh', '-c', `kill -${signal} -${pid} 2>/dev/null || kill -${signal} ${pid}`],
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
      })
      // Detached: the stream only exists because the client wants its output, and there is none.
      const stream = asStream(await exec.start({ Detach: false, Tty: false }))
      stream?.destroy()
    } catch {
      // The container is gone, which is the state the signal was meant to produce.
    }
  }

  async #finish(code: number | null): Promise<void> {
    if (this.#ended) return
    this.#ended = true
    this.#exitCode = code

    const exit: PtyExit = { code, signal: null }
    for (const listener of this.#exits) listener(exit)
    this.#exits.clear()
  }
}
