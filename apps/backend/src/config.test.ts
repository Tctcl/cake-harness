import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig } from './config.js'

const DATABASE_URL = 'postgres://user:pass@localhost:5432/tlabs'

describe('loadConfig', () => {
  it('applies defaults for the optional variables', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'info',
      databaseUrl: DATABASE_URL,
      databasePoolSize: 10,
      docker: { socketPath: '/var/run/docker.sock' },
      workspaceImage: 'tctcl/dev-env:dev',
      channel: 'production',
      version: undefined,
      updateCheckIntervalMs: 900_000,
      frontendDir: undefined,
    })
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
        DATABASE_URL: 'postgres://user:pass@db.internal:5432/tlabs',
        DATABASE_POOL_SIZE: '4',
      }),
    ).toEqual({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'debug',
      databaseUrl: 'postgres://user:pass@db.internal:5432/tlabs',
      databasePoolSize: 4,
      docker: { socketPath: '/var/run/docker.sock' },
      workspaceImage: 'tctcl/dev-env:dev',
      channel: 'production',
      version: undefined,
      updateCheckIntervalMs: 900_000,
      frontendDir: undefined,
    })
  })

  it('accepts both postgres URL schemes', () => {
    expect(loadConfig({ DATABASE_URL: 'postgresql://db/tlabs' }).databaseUrl).toBe(
      'postgresql://db/tlabs',
    )
  })

  it('rejects a connection string that is not a postgres URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://db/tlabs' })).toThrow(
      'must be a postgres:// or postgresql:// URL',
    )
    expect(() => loadConfig({ DATABASE_URL: 'db.internal:5432' })).toThrow(ConfigError)
  })

  it('rejects a pool size outside 1..100', () => {
    expect(() => loadConfig({ DATABASE_URL, DATABASE_POOL_SIZE: '0' })).toThrow(ConfigError)
    expect(() => loadConfig({ DATABASE_URL, DATABASE_POOL_SIZE: '101' })).toThrow(ConfigError)
    expect(() => loadConfig({ DATABASE_URL, DATABASE_POOL_SIZE: '2.5' })).toThrow(ConfigError)
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
