import { randomUUID } from 'node:crypto'

import { AppError } from '../errors.js'
import {
  clampSize,
  DEFAULT_TERMINAL_SIZE,
  type TerminalLimits,
  type TerminalSize,
  type TerminalView,
} from './contract.js'
import type { Pty, PtyExit, PtyFactory } from './pty.js'

/** Recent output kept per session. Bounded: a runaway program must not be able to grow the process without limit. */
const MAX_SCROLLBACK_BYTES = 1024 * 1024

/** Events that are not traffic but keep a session alive: a reattach and a resize from a client that is still there. */
const REAPER_INTERVAL_MS = 10_000

/**
 * The last `limit` bytes written to it, oldest first. A ring rather than a growing array because output arrives
 * forever and a session's memory has to stop somewhere.
 */
class Scrollback {
  // Typed explicitly: `Buffer.alloc` returns `Buffer<ArrayBuffer>`, and `Buffer.concat` widens to `ArrayBufferLike`.
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  constructor(readonly limit: number) {}

  write(chunk: Buffer): void {
    if (chunk.length >= this.limit) {
      this.#buffer = chunk.subarray(chunk.length - this.limit)

      return
    }

    const room = this.limit - this.#buffer.length
    this.#buffer =
      chunk.length <= room
        ? Buffer.concat([this.#buffer, chunk])
        : Buffer.concat([this.#buffer.subarray(chunk.length - room), chunk])
  }

  read(): Buffer {
    return this.#buffer
  }
}

/** What a connected client gives up when it attaches: bytes to send, and the end of the session to hear about. */
export interface TerminalSink {
  emit(chunk: Buffer): void
  ended(exit: PtyExit): void
}

export interface TerminalAttachment {
  /** Output produced before the attach, oldest first, so a reattach is not a blank screen. */
  readonly replay: Buffer
  readonly size: TerminalSize
  detach(): void
}

interface SessionRecord {
  readonly id: string
  readonly environmentId: string
  readonly label: string
  readonly createdAt: Date
  readonly pty: Pty
  readonly scrollback: Scrollback
  size: TerminalSize
  sink: TerminalSink | undefined
  lastActivityAt: number
  exit: PtyExit | undefined
  closed: boolean
}

export interface CreateTerminalRequest {
  readonly environmentId: string
  /** Null on a stopped environment: the caller answers 409 rather than starting something here. */
  readonly containerId: string | null
  readonly label?: string | undefined
  readonly size?: TerminalSize | undefined
}

export interface TerminalSessionsOptions {
  readonly ptys: PtyFactory
  readonly limits: TerminalLimits
  /** The program a new session runs. A shell, because the panel is a terminal and not a task runner. */
  readonly command: readonly string[]
  readonly now?: () => number
}

/**
 * Owns terminal sessions for every environment in the process.
 *
 * A session outlives the client connection on purpose: closing the panel must not kill a running build, and a
 * reattach must replay what the program printed while nobody was looking. It ends when the program ends, when the
 * session is closed, or when it has sat idle with no client attached past the configured timeout.
 */
export class TerminalSessions {
  readonly #ptys: PtyFactory
  readonly #limits: TerminalLimits
  readonly #command: readonly string[]
  readonly #now: () => number
  readonly #sessions = new Map<string, SessionRecord>()
  readonly #listeners = new Set<() => void>()
  #reaper: NodeJS.Timeout | undefined

  constructor(options: TerminalSessionsOptions) {
    this.#ptys = options.ptys
    this.#limits = options.limits
    this.#command = options.command
    this.#now = options.now ?? Date.now
    this.#arm()
  }

  /** Called after anything a session list would show differently, so the environment's surface can announce it. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  list(environmentId: string): TerminalView[] {
    return [...this.#sessions.values()]
      .filter((session) => session.environmentId === environmentId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((session) => this.#view(session))
  }

  view(id: string): TerminalView {
    return this.#view(this.#require(id))
  }

  async create(request: CreateTerminalRequest): Promise<TerminalView> {
    if (request.containerId === null) {
      throw new AppError('the environment is not running', { statusCode: 409, code: 'ENVIRONMENT_STOPPED' })
    }

    const existing = this.list(request.environmentId)
    if (existing.length >= this.#limits.maxSessions) {
      throw new AppError(`this environment already has ${this.#limits.maxSessions} terminals open`, {
        statusCode: 409,
        code: 'TERMINAL_LIMIT_REACHED',
      })
    }

    const size = clampSize(request.size ?? DEFAULT_TERMINAL_SIZE, DEFAULT_TERMINAL_SIZE)
    const pty = await this.#ptys.open({ containerId: request.containerId, size, command: this.#command })

    const id = randomUUID()
    const session: SessionRecord = {
      id,
      environmentId: request.environmentId,
      label: request.label ?? `Terminal ${existing.length + 1}`,
      createdAt: new Date(this.#now()),
      pty,
      scrollback: new Scrollback(Math.min(this.#limits.scrollbackBytes, MAX_SCROLLBACK_BYTES)),
      size,
      sink: undefined,
      lastActivityAt: this.#now(),
      exit: undefined,
      closed: false,
    }
    this.#sessions.set(id, session)

    pty.onData((chunk) => {
      session.scrollback.write(chunk)
      session.lastActivityAt = this.#now()
      session.sink?.emit(chunk)
    })
    pty.onExit((exit) => {
      session.exit = exit
      session.sink?.ended(exit)
      session.sink = undefined
      this.#changed()
    })

    this.#changed()

    return this.#view(session)
  }

  attach(id: string, sink: TerminalSink): TerminalAttachment {
    const session = this.#require(id)
    if (session.exit !== undefined) {
      throw new AppError('that terminal has exited', { statusCode: 409, code: 'TERMINAL_EXITED' })
    }

    // One client at a time: dockerode's hijacked stream has no way to demultiplex two writers, and a second writer
    // would interleave keystrokes into the same program.
    if (session.sink !== undefined) {
      throw new AppError('that terminal already has a client attached', {
        statusCode: 409,
        code: 'TERMINAL_BUSY',
      })
    }

    session.sink = sink
    session.lastActivityAt = this.#now()
    this.#changed()

    return {
      replay: session.scrollback.read(),
      size: session.size,
      detach: () => {
        if (session.sink === sink) {
          session.sink = undefined
          session.lastActivityAt = this.#now()
          this.#changed()
        }
      },
    }
  }

  write(id: string, bytes: Uint8Array): void {
    const session = this.#require(id)
    if (session.exit !== undefined) return
    session.lastActivityAt = this.#now()
    session.pty.write(bytes)
  }

  resize(id: string, size: TerminalSize): TerminalSize {
    const session = this.#require(id)
    const next = clampSize(size, session.size)
    if (next.cols === session.size.cols && next.rows === session.size.rows) return next

    session.size = next
    session.lastActivityAt = this.#now()
    if (session.exit === undefined) session.pty.resize(next)
    this.#changed()

    return next
  }

  /** Ends every session belonging to an environment, which is what a stopped environment must not leave behind. */
  async closeEnvironment(environmentId: string): Promise<string[]> {
    const ids = [...this.#sessions.values()]
      .filter((session) => session.environmentId === environmentId)
      .map((session) => session.id)
    await Promise.all(ids.map(async (id) => this.close(id)))

    return ids
  }

  async close(id: string): Promise<void> {
    const session = this.#require(id)
    if (session.closed) return
    session.closed = true

    session.sink?.ended(session.exit ?? { code: null, signal: null })
    session.sink = undefined

    try {
      await session.pty.kill()
    } finally {
      this.#sessions.delete(id)
      this.#changed()
    }
  }

  /** Ends every session. Called on shutdown so no `docker exec` outlives the process that created it. */
  async shutdown(): Promise<void> {
    this.#disarm()
    await Promise.all([...this.#sessions.keys()].map(async (id) => this.close(id)))
  }

  #view(session: SessionRecord): TerminalView {
    return {
      id: session.id,
      environmentId: session.environmentId,
      label: session.label,
      createdAt: session.createdAt,
      size: session.size,
      attached: session.sink !== undefined,
    }
  }

  #require(id: string): SessionRecord {
    const session = this.#sessions.get(id)
    if (session === undefined) {
      throw new AppError('that terminal does not exist', { statusCode: 404, code: 'TERMINAL_NOT_FOUND' })
    }

    return session
  }

  #changed(): void {
    for (const listener of this.#listeners) listener()
  }

  /**
   * Reaps sessions nobody is looking at. A timer rather than a check on every event because the interesting case is
   * silence: a client that vanished without closing the socket produces no further events at all.
   *
   * `unref()` keeps the timer from holding the process open, which matters for a CLI that builds a server and never
   * listens on it.
   */
  #arm(): void {
    if (this.#limits.idleTimeoutMs <= 0) return

    this.#reaper = setInterval(() => {
      void this.#reap()
    }, Math.min(REAPER_INTERVAL_MS, this.#limits.idleTimeoutMs))
    this.#reaper.unref()
  }

  #disarm(): void {
    if (this.#reaper === undefined) return
    clearInterval(this.#reaper)
    this.#reaper = undefined
  }

  async #reap(): Promise<void> {
    const now = this.#now()
    const stale = [...this.#sessions.values()].filter(
      (session) =>
        session.sink === undefined &&
        session.exit === undefined &&
        now - session.lastActivityAt >= this.#limits.idleTimeoutMs,
    )

    await Promise.all(stale.map(async (session) => this.close(session.id)))
  }
}
