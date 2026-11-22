import { describe, expect, it } from 'vitest'

import { ConfigError, loadConfig } from './config.js'

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'info',
    })
  })

  it('reads and coerces the configured values', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '3000',
        LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      nodeEnv: 'production',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'debug',
    })
  })

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow(ConfigError)
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(ConfigError)
  })

  it('rejects an unknown NODE_ENV and LOG_LEVEL', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(ConfigError)
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(ConfigError)
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
