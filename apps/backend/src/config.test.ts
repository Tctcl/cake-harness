import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig } from './config.js'

const DATABASE_URL = 'postgres://user:pass@localhost:5432/cake'

describe('loadConfig', () => {
  it('applies defaults for the optional variables', () => {
    expect(loadConfig({ DATABASE_URL })).toMatchObject({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'info',
      databaseUrl: DATABASE_URL,
      databasePoolSize: 10,
      docker: { socketPath: '/var/run/docker.sock' },
      workspaceImage: 'cake-harness/dev-env:dev',
      workspaceBackendUrl: null,
      workspaceNetwork: null,
      channel: 'production',
      version: undefined,
      updateCheckIntervalMs: 900_000,
      frontendDir: undefined,
      trustProxy: false,
    })
  })

  it('reads SSH configuration and defaults its host to DOMAIN, then the Docker host', () => {
    expect(loadConfig({ DATABASE_URL })).toMatchObject({
      sshHost: '127.0.0.1',
      sshPortRange: { first: 22_000, last: 22_999 },
    })
    expect(loadConfig({ DATABASE_URL, DOMAIN: 'cake.example.com' }).sshHost).toBe('cake.example.com')
    expect(loadConfig({ DATABASE_URL, DOMAIN: 'cake.example.com', CAKE_SSH_HOST: 'ssh.example.com' }).sshHost)
      .toBe('ssh.example.com')
    expect(loadConfig({ DATABASE_URL, DOCKER_HOST: 'tcp://docker.internal:2375' }).sshHost).toBe('docker.internal')
    expect(loadConfig({ DATABASE_URL, CAKE_SSH_PORT_RANGE: '23000-23010' }).sshPortRange)
      .toEqual({ first: 23_000, last: 23_010 })
    expect(() => loadConfig({ DATABASE_URL, CAKE_SSH_PORT_RANGE: '23010-23000' })).toThrow(/CAKE_SSH_PORT_RANGE/)
    expect(() => loadConfig({ DATABASE_URL, CAKE_SSH_PORT_RANGE: '22000' })).toThrow(/CAKE_SSH_PORT_RANGE/)
  })

  it('derives a seal key in development and refuses to run without one in production', () => {
    const development = loadConfig({ DATABASE_URL })
    expect(development.secrets.open(development.secrets.seal('secret'))).toBe('secret')

    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL })).toThrow(/SECRET_KEY/)
    expect(() => loadConfig({ DATABASE_URL, SECRET_KEY: 'short' })).toThrow(/SECRET_KEY/)
  })

  it('reads TRUST_PROXY as text rather than as a truthy string', () => {
    expect(loadConfig({ DATABASE_URL, TRUST_PROXY: 'true' }).trustProxy).toBe(true)
    // Coercion would read every string as `true`, so the flag is compared rather than coerced.
    expect(loadConfig({ DATABASE_URL, TRUST_PROXY: 'false' }).trustProxy).toBe(false)
    expect(() => loadConfig({ DATABASE_URL, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/)
  })

  it('requires the database URL', () => {
    try {
      loadConfig({})
      expect.unreachable('loadConfig should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).issues.join('\n')).toContain('DATABASE_URL')
    }
  })

  it('reads and coerces the configured values', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3000',
        LOG_LEVEL: 'debug',
        DATABASE_URL: 'postgres://user:pass@db.internal:5432/cake',
        DATABASE_POOL_SIZE: '4',
        SECRET_KEY: 'a-production-secret-key',
      }),
    ).toMatchObject({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'debug',
      databaseUrl: 'postgres://user:pass@db.internal:5432/cake',
      databasePoolSize: 4,
      docker: { socketPath: '/var/run/docker.sock' },
      workspaceImage: 'cake-harness/dev-env:dev',
      workspaceBackendUrl: null,
      workspaceNetwork: null,
      channel: 'production',
      version: undefined,
      updateCheckIntervalMs: 900_000,
      frontendDir: undefined,
      trustProxy: false,
    })
  })

  it('wires a workspace to the backend only when both halves are configured', () => {
    const wired = loadConfig({
      DATABASE_URL,
      WORKSPACE_BACKEND_URL: 'http://backend:8080/',
      WORKSPACE_NETWORK: 'cake-workspaces',
    })

    expect(wired.workspaceBackendUrl).toBe('http://backend:8080')
    expect(wired.workspaceNetwork).toBe('cake-workspaces')

    expect(() => loadConfig({ DATABASE_URL, WORKSPACE_BACKEND_URL: 'http://backend:8080' })).toThrow(
      /WORKSPACE_NETWORK: required/,
    )
    expect(() => loadConfig({ DATABASE_URL, WORKSPACE_NETWORK: 'cake-workspaces' })).toThrow(
      /WORKSPACE_BACKEND_URL: required/,
    )
  })

  it('accepts both postgres URL schemes', () => {
    expect(loadConfig({ DATABASE_URL: 'postgresql://db/cake' }).databaseUrl).toBe(
      'postgresql://db/cake',
    )
  })

  it('rejects a connection string that is not a postgres URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://db/cake' })).toThrow(
      'must be a postgres:// or postgresql:// URL',
    )
    expect(() => loadConfig({ DATABASE_URL: 'db.internal:5432' })).toThrow(ConfigError)
  })

  it('rejects a pool size outside 1..100', () => {
    expect(() => loadConfig({ DATABASE_URL, DATABASE_POOL_SIZE: '0' })).toThrow(ConfigError)
    expect(() => loadConfig({ DATABASE_URL, DATABASE_POOL_SIZE: '101' })).toThrow(ConfigError)
    expect(() => loadConfig({ DATABASE_URL, DATABASE_POOL_SIZE: '2.5' })).toThrow(ConfigError)
  })

  it('reads an empty CAKE_VERSION as no version, the way a staging install passes it', () => {
    expect(loadConfig({ DATABASE_URL, CAKE_CHANNEL: 'staging', CAKE_VERSION: '' })).toMatchObject({
      channel: 'staging',
      version: undefined,
    })
    expect(loadConfig({ DATABASE_URL, CAKE_VERSION: '1.2.3' }).version).toBe('1.2.3')
    expect(() => loadConfig({ DATABASE_URL, CAKE_VERSION: 'staging' })).toThrow(/CAKE_VERSION/)
  })

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ DATABASE_URL, PORT: '70000' })).toThrow(ConfigError)
    expect(() => loadConfig({ DATABASE_URL, PORT: 'not-a-port' })).toThrow(ConfigError)
  })

  it('rejects an unknown NODE_ENV and LOG_LEVEL', () => {
    expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'staging' })).toThrow(ConfigError)
    expect(() => loadConfig({ DATABASE_URL, LOG_LEVEL: 'verbose' })).toThrow(ConfigError)
  })

  it('lists every invalid variable in the message', () => {
    try {
      loadConfig({ NODE_ENV: 'staging', PORT: '0' })
      expect.unreachable('loadConfig should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const { message } = error as ConfigError
      expect(message).toContain('NODE_ENV')
      expect(message).toContain('PORT')
    }
  })
})
