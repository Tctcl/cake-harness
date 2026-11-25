import { once } from 'node:events'
import { PassThrough, Writable } from 'node:stream'

import type Docker from 'dockerode'
import { describe, expect, it, vi } from 'vitest'

import { runDaemonBridge } from './daemon-bridge.js'

const sink = (): Writable => new Writable({ write(_chunk, _encoding, callback) { callback() } })

describe('runDaemonBridge', () => {
  it('forwards Connection token arguments, demuxes the hijacked stream and returns the exec exit code', async () => {
    const transport = new PassThrough()
    const input = new PassThrough()
    const output = sink()
    const error = sink()
    const execOptions: Docker.ExecCreateOptions[] = []
    const startOptions: Docker.ExecStartOptions[] = []
    const demux = vi.fn((stream: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream) => {
      expect(stream).toBe(transport)
      expect(stdout).toBe(output)
      expect(stderr).toBe(error)
      stdout.write('clean protocol bytes')
      stderr.write('diagnostic bytes')
    })
    const exec = {
      start: async (options: Docker.ExecStartOptions) => {
        startOptions.push(options)
        return transport
      },
      inspect: async () => ({ Running: false, ExitCode: 23 }),
    }
    const docker = {
      getContainer: (id: string) => {
        expect(id).toBe('container-1')
        return {
          exec: async (options: Docker.ExecCreateOptions) => {
            execOptions.push(options)
            return exec
          },
        }
      },
      modem: { demuxStream: demux },
    } as unknown as Docker
    const token = '0123456789abcdef0123456789abcdef'
    const received = once(transport, 'data')

    const exitCode = await runDaemonBridge({
      argv: ['container-1', '/home/dev/.local/share/tlabs/pi-env-1.6.0', 'serve', '--token', token],
      docker,
      input,
      output,
      error,
    })
    input.end('client frame')
    await received

    expect(exitCode).toBe(23)
    expect(execOptions).toEqual([{
      Cmd: ['/home/dev/.local/share/tlabs/pi-env-1.6.0', 'serve', '--token', token],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: 'dev',
      WorkingDir: '/home/dev/workspace',
    }])
    expect(startOptions).toEqual([{ hijack: true, stdin: true, Tty: false }])
    expect(demux).toHaveBeenCalledOnce()
  })

  it('refuses an argv without Connection token handshake before touching Docker', async () => {
    await expect(runDaemonBridge({
      argv: ['container-1', '/daemon'],
      docker: {} as Docker,
      input: new PassThrough(),
      output: sink(),
      error: sink(),
    })).rejects.toThrow('usage: daemon-bridge')
  })
})
