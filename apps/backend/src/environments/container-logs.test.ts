import { describe, expect, it } from 'vitest'

import type { ContainerLogLine } from './container-logs.js'
import { lineSplitter, parseLogLine } from './container-logs.js'

const collect = (stream: ContainerLogLine['stream']) => {
  const lines: ContainerLogLine[] = []

  return { lines, writable: lineSplitter(stream, (line) => lines.push(line)) }
}

const write = (writable: NodeJS.WritableStream, chunk: string): Promise<void> =>
  new Promise((resolve, reject) => writable.write(chunk, (error) => (error ? reject(error) : resolve())))

const end = (writable: NodeJS.WritableStream): Promise<void> => new Promise((resolve) => writable.end(resolve))

describe('container log lines', () => {
  it('splits Docker timestamps from the text', () => {
    expect(parseLogLine('stdout', '2026-11-25T23:03:25.945123456Z {"event":"bootstrap.start"}')).toEqual({
      stream: 'stdout',
      at: '2026-11-25T23:03:25.945123456Z',
      text: '{"event":"bootstrap.start"}',
    })
  })

  it('keeps a line without a timestamp whole and drops a carriage return', () => {
    expect(parseLogLine('stderr', 'Server listening on 0.0.0.0 port 22.\r')).toEqual({
      stream: 'stderr',
      at: null,
      text: 'Server listening on 0.0.0.0 port 22.',
    })
  })

  it('cuts a runaway line', () => {
    expect(parseLogLine('stdout', 'x'.repeat(20_000)).text).toHaveLength(8_001)
  })

  it('joins a line split across chunks and separates lines sharing one', async () => {
    const { lines, writable } = collect('stdout')

    await write(writable, '2026-11-25T23:00:00Z first par')
    await write(writable, 't\n2026-11-25T23:00:01Z second\n2026-11-25T23:00:02Z thi')
    expect(lines.map((line) => line.text)).toEqual(['first part', 'second'])

    await end(writable)
    expect(lines.map((line) => line.text)).toEqual(['first part', 'second', 'thi'])
  })
})
