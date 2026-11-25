import { describe, expect, it, vi } from 'vitest'

import type { TerminalSize } from './contract.js'
import type { Pty, PtyExit, PtyFactory, PtyOpenRequest } from './pty.js'
import { TerminalSessions } from './sessions.js'

/**
 * A PTY that records what it was told and replays what the caller asks for. The real one needs a container, and the
 * bookkeeping under test is precisely the part that must not.
 */
class FakePty implements Pty {
  readonly written: Buffer[] = []
  readonly resizes: TerminalSize[] = []
  readonly #data: ((chunk: Buffer) => void)[] = []
  readonly #exits: ((exit: PtyExit) => void)[] = []
  kills = 0

  onData(listener: (chunk: Buffer) => void): void {
    this.#data.push(listener)
  }

  onExit(listener: (exit: PtyExit) => void): void {
    this.#exits.push(listener)
  }

  write(bytes: Uint8Array): boolean {
    this.written.push(Buffer.from(bytes))

    return true
  }

  resize(size: TerminalSize): void {
    this.resizes.push(size)
  }

  async kill(): Promise<void> {
    this.kills += 1
    this.stop({ code: 0, signal: null })
  }

  /** Output from the program. */
  emit(text: string): void {
    for (const listener of this.#data) listener(Buffer.from(text))
  }

  /** The program leaving on its own, which is what an `exit` in the shell looks like. */
  stop(exit: PtyExit): void {
    for (const listener of this.#exits) listener(exit)
  }
}

class FakePtys implements PtyFactory {
  readonly requests: PtyOpenRequest[] = []
  readonly ptys: FakePty[] = []

  async open(request: PtyOpenRequest): Promise<Pty> {
    this.requests.push(request)
    const pty = new FakePty()
    this.ptys.push(pty)

    return pty
  }

  /** The last PTY handed out: a test creates one session and talks to it. */
  get only(): FakePty {
    const pty = this.ptys.at(-1)
    if (pty === undefined) throw new Error('no PTY was opened')

    return pty
  }
}

const limits = { maxSessions: 2, scrollbackBytes: 8, idleTimeoutMs: 0 }

const sessionsOf = (ptys: FakePtys, overrides: Partial<typeof limits> = {}): TerminalSessions =>
  new TerminalSessions({
    ptys,
    limits: { ...limits, ...overrides },
    command: ['/bin/sh'],
  })

const create = (sessions: TerminalSessions, environmentId = 'env'): Promise<unknown> =>
  sessions.create({ environmentId, containerId: 'container', label: undefined, size: undefined })

describe('TerminalSessions', () => {
  it('labels sessions in order per environment and lists them oldest first', async () => {
    const sessions = sessionsOf(new FakePtys())
    await create(sessions, 'one')
    await create(sessions, 'one')
    await create(sessions, 'two')

    expect(sessions.list('one').map((view) => view.label)).toEqual(['Terminal 1', 'Terminal 2'])
    expect(sessions.list('two').map((view) => view.label)).toEqual(['Terminal 1'])
    expect(sessions.list('three')).toEqual([])
  })

  it('opens the PTY inside the environment container with the configured shell', async () => {
    const ptys = new FakePtys()
    await create(sessionsOf(ptys))

    expect(ptys.requests[0]?.containerId).toBe('container')
    expect(ptys.requests[0]?.command).toEqual(['/bin/sh'])
    expect(ptys.requests[0]?.size).toEqual({ cols: 80, rows: 24 })
  })

  it('answers with the bytes written before the attach, newest last', async () => {
    const ptys = new FakePtys()
    const sessions = sessionsOf(ptys, { scrollbackBytes: 4 })
    const view = (await create(sessions)) as { id: string }
    ptys.only.emit('abcdef')

    const sink = { emit: (): void => undefined, ended: (): void => undefined }
    // Four bytes fit, so the replay is the tail and never the head: a terminal resumes where it stopped.
    expect(sessions.attach(view.id, sink).replay.toString()).toBe('cdef')
  })

  it('forwards written bytes and a clamped resize to the PTY', async () => {
    const ptys = new FakePtys()
    const sessions = sessionsOf(ptys)
    const view = (await create(sessions)) as { id: string }

    sessions.write(view.id, Buffer.from('ls\r'))
    const size = sessions.resize(view.id, { cols: 9000, rows: 0 })

    expect(ptys.only.written.map((chunk) => chunk.toString())).toEqual(['ls\r'])
    expect(size).toEqual({ cols: 500, rows: 1 })
    expect(ptys.only.resizes).toEqual([{ cols: 500, rows: 1 }])
  })

  it('refuses a second client and a session that already exited', async () => {
    const ptys = new FakePtys()
    const sessions = sessionsOf(ptys, { maxSessions: 4 })
    const view = (await create(sessions)) as { id: string }
    const sink = { emit: (): void => undefined, ended: (): void => undefined }
    const attachment = sessions.attach(view.id, sink)

    expect(() => sessions.attach(view.id, sink)).toThrow(/already has a client attached/)

    // Detached first: the point is that the *session* refuses, not that a stale client is still holding it.
    attachment.detach()
    ptys.only.stop({ code: 0, signal: null })

    expect(() => sessions.attach(view.id, sink)).toThrow(/has exited/)
  })

  it('tells the attached client when the program ends', async () => {
    const ptys = new FakePtys()
    const sessions = sessionsOf(ptys)
    const view = (await create(sessions)) as { id: string }
    const ended: unknown[] = []
    sessions.attach(view.id, { emit: (): void => undefined, ended: (exit) => ended.push(exit) })

    ptys.only.stop({ code: 2, signal: null })

    expect(ended).toEqual([{ code: 2, signal: null }])
    expect(sessions.view(view.id).attached).toBe(false)
  })

  it('refuses more sessions than the cap allows', async () => {
    const sessions = sessionsOf(new FakePtys(), { maxSessions: 1 })
    await create(sessions)

    await expect(create(sessions)).rejects.toMatchObject({ code: 'TERMINAL_LIMIT_REACHED', statusCode: 409 })
  })

  it('refuses to open a session on a stopped environment', async () => {
    const sessions = sessionsOf(new FakePtys())

    await expect(
      sessions.create({ environmentId: 'env', containerId: null, label: undefined, size: undefined }),
    ).rejects.toMatchObject({ code: 'ENVIRONMENT_STOPPED', statusCode: 409 })
  })

  it('kills the process when a session is closed and forgets it', async () => {
    const ptys = new FakePtys()
    const sessions = sessionsOf(ptys)
    const view = (await create(sessions)) as { id: string }

    await sessions.close(view.id)

    expect(ptys.only.kills).toBe(1)
    expect(sessions.list('env')).toEqual([])
    expect(() => sessions.write(view.id, Buffer.from('x'))).toThrow(/does not exist/)
  })

  it('reaps a session that has been idle with no client attached', async () => {
    vi.useFakeTimers()
    try {
      const ptys = new FakePtys()
      const sessions = sessionsOf(ptys, { idleTimeoutMs: 1000 })
      const view = (await create(sessions)) as { id: string }
      sessions.attach(view.id, { emit: (): void => undefined, ended: (): void => undefined }).detach()

      await vi.advanceTimersByTimeAsync(3000)

      expect(sessions.list('env')).toEqual([])
      expect(ptys.only.kills).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes every session on shutdown', async () => {
    const ptys = new FakePtys()
    const sessions = sessionsOf(ptys)
    await create(sessions, 'one')
    await create(sessions, 'two')

    await sessions.shutdown()

    expect(ptys.ptys.every((pty) => pty.kills === 1)).toBe(true)
    expect(sessions.list('one')).toEqual([])
  })

  it('closes what belongs to one environment and nothing else', async () => {
    const ptys = new FakePtys()
    const sessions = sessionsOf(ptys, { maxSessions: 4 })
    await create(sessions, 'one')
    await create(sessions, 'two')

    expect(await sessions.closeEnvironment('one')).toHaveLength(1)
    expect(sessions.list('two')).toHaveLength(1)
  })
})
