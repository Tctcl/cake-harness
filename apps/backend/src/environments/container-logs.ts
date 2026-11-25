import { Writable } from 'node:stream'

import type Docker from 'dockerode'

/** One line of a container's output, as Docker recorded it. */
export interface ContainerLogLine {
  readonly stream: 'stdout' | 'stderr'
  /** Docker's own timestamp for the line, or null when it carried none. */
  readonly at: string | null
  readonly text: string
}

/** Stops following; calling it more than once is harmless. */
export type StopFollowing = () => void

/** The tail a follow starts with, so a reader sees why a container is in its current state, not only what comes next. */
export const DEFAULT_LOG_TAIL = 200

/** A line longer than this is cut: one runaway line must not hold a megabyte in memory or in a browser row. */
const MAX_LINE_LENGTH = 8_000

/** `docker logs --timestamps` prefixes every line with an RFC 3339 time and one space. */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) /

export const parseLogLine = (stream: ContainerLogLine['stream'], raw: string): ContainerLogLine => {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
  const match = TIMESTAMP.exec(line)
  const text = match === null ? line : line.slice(match[0].length)

  return {
    stream,
    at: match?.[1] ?? null,
    text: text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text,
  }
}

/**
 * A writable that turns a byte stream into whole lines. Docker hands over arbitrary chunks, so a line can arrive in two
 * pieces and two lines in one; the remainder is held until its newline comes, and flushed when the stream ends.
 */
export const lineSplitter = (stream: ContainerLogLine['stream'], onLine: (line: ContainerLogLine) => void): Writable => {
  let pending = ''

  return new Writable({
    write(chunk: unknown, _encoding, callback) {
      pending += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) onLine(parseLogLine(stream, line))
      callback()
    },
    final(callback) {
      if (pending !== '') onLine(parseLogLine(stream, pending))
      pending = ''
      callback()
    },
  })
}

/**
 * Follow a container's output: the last `tail` lines first, then every new line until the container stops or `stop` is
 * called. `onEnd` runs once when Docker closes the stream (a stopped container's log ends right after its tail).
 */
export const followContainerLogs = async (
  docker: Docker,
  containerId: string,
  options: { readonly tail: number; readonly onLine: (line: ContainerLogLine) => void; readonly onEnd: () => void },
): Promise<StopFollowing> => {
  const stream = await docker.getContainer(containerId).logs({
    follow: true,
    stdout: true,
    stderr: true,
    timestamps: true,
    tail: options.tail,
  })
  const stdout = lineSplitter('stdout', options.onLine)
  const stderr = lineSplitter('stderr', options.onLine)
  // Without a TTY Docker multiplexes stdout and stderr with 8-byte frame headers; demuxing keeps them out of the text.
  docker.modem.demuxStream(stream, stdout, stderr)

  let ended = false
  const end = (): void => {
    if (ended) return
    ended = true
    stdout.end()
    stderr.end()
    options.onEnd()
  }
  stream.once('end', end)
  stream.once('close', end)
  stream.once('error', end)

  return () => {
    // `destroy` closes the HTTP connection to Docker, which is what stops a follow; `end` would wait for more output.
    if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy()
    end()
  }
}
