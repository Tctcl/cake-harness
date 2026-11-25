import { describe, expect, it } from 'vitest'

import { dockerHostOf, readSshEndpoint, sshAccessOf } from './ssh-access.js'

const running = (ports: unknown): unknown => ({
  State: { Running: true },
  NetworkSettings: { Ports: { '22/tcp': ports } },
})

describe('dockerHostOf', () => {
  it('answers loopback for a local socket, because the daemon is this machine', () => {
    expect(dockerHostOf({ socketPath: '/var/run/docker.sock' })).toBe('127.0.0.1')
  })

  it('answers the daemon host when Docker runs over TCP', () => {
    expect(dockerHostOf({ host: 'docker.internal', port: 2375 })).toBe('docker.internal')
  })
})

describe('readSshEndpoint', () => {
  it('reads the published port Docker assigned', () => {
    expect(readSshEndpoint(running([{ HostIp: '127.0.0.1', HostPort: '2222' }]), '127.0.0.1')).toEqual({
      host: '127.0.0.1',
      port: 2222,
    })
  })

  it('answers null when no port was published, which is how Cake creates containers', () => {
    expect(readSshEndpoint(running(null), '127.0.0.1')).toBeNull()
    expect(readSshEndpoint(running([]), '127.0.0.1')).toBeNull()
  })

  it('answers null for a stopped container, because the mapping outlives the listener', () => {
    const inspected = { State: { Running: false }, NetworkSettings: { Ports: { '22/tcp': [{ HostPort: '2222' }] } } }

    expect(readSshEndpoint(inspected, '127.0.0.1')).toBeNull()
  })

  it('survives a reading Docker does not answer in the shape it documents', () => {
    expect(readSshEndpoint(undefined, '127.0.0.1')).toBeNull()
    expect(readSshEndpoint({}, '127.0.0.1')).toBeNull()
    expect(readSshEndpoint({ State: { Running: true } }, '127.0.0.1')).toBeNull()
    expect(readSshEndpoint(running([{ HostPort: 'not-a-port' }]), '127.0.0.1')).toBeNull()
    expect(readSshEndpoint(running([{ HostPort: '0' }]), '127.0.0.1')).toBeNull()
  })
})

describe('sshAccessOf', () => {
  it('spells the endpoint out as a command that can be pasted', () => {
    expect(sshAccessOf({ host: '127.0.0.1', port: 2222 })).toEqual({
      command: 'ssh -p 2222 dev@127.0.0.1',
      host: '127.0.0.1',
      port: 2222,
      user: 'dev',
    })
  })
})
