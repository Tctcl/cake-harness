import { describe, expect, it } from 'vitest'

import { isConnectFailure, isTransient, withRetry, withRetryUntil } from './retry.js'

const withCode = (code: string): Error => Object.assign(new Error(code), { code })

const transient = { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 }

const alwaysFail = (error: Error) => {
  let calls = 0

  return {
    calls: () => calls,
    run: async (): Promise<never> => {
      calls += 1
      throw error
    },
  }
}

describe('failure classification', () => {
  it('treats a refused connection as safe to replay even for a write', () => {
    expect(isConnectFailure(withCode('ECONNREFUSED'))).toBe(true)
    expect(isTransient(withCode('ECONNREFUSED'))).toBe(true)
    expect(isConnectFailure(withCode('57P03'))).toBe(true)
    expect(isConnectFailure(withCode('53300'))).toBe(true)
  })

  it('treats a lost connection as retryable only for a read', () => {
    expect(isConnectFailure(withCode('ECONNRESET'))).toBe(false)
    expect(isTransient(withCode('ECONNRESET'))).toBe(true)
    expect(isConnectFailure(withCode('57P01'))).toBe(false)
    expect(isTransient(withCode('08006'))).toBe(true)
  })

  it('does not replay a write after a timeout, which may hit an open connection mid-statement', () => {
    expect(isConnectFailure(withCode('ETIMEDOUT'))).toBe(false)
    expect(isTransient(withCode('ETIMEDOUT'))).toBe(true)
  })

  it('ignores errors that carry no code', () => {
    expect(isConnectFailure(new Error('boom'))).toBe(false)
    expect(isTransient(new Error('boom'))).toBe(false)
    expect(isTransient('ECONNRESET')).toBe(false)
    expect(isTransient(undefined)).toBe(false)
    expect(isTransient({ code: 42 })).toBe(false)
  })
})

describe('withRetry', () => {
  it('returns the first successful result', async () => {
    let calls = 0
    const result = await withRetry(transient, isTransient, async () => {
      calls += 1
      if (calls === 1) throw withCode('ECONNRESET')

      return 'settled'
    })

    expect(result).toBe('settled')
    expect(calls).toBe(2)
  })

  it('rethrows once the attempts are spent', async () => {
    const failure = alwaysFail(withCode('ECONNRESET'))

    await expect(withRetry(transient, isTransient, failure.run)).rejects.toThrow('ECONNRESET')
    expect(failure.calls()).toBe(3)
  })

  it('does not repeat a failure the policy refuses', async () => {
    const failure = alwaysFail(new Error('syntax error at or near "id"'))

    await expect(withRetry(transient, isTransient, failure.run)).rejects.toThrow('syntax error')
    expect(failure.calls()).toBe(1)
  })
})

describe('withRetryUntil', () => {
  it('gives up when the deadline passes', async () => {
    const failure = alwaysFail(withCode('ECONNREFUSED'))
    const started = Date.now()

    await expect(
      withRetryUntil(20, { baseDelayMs: 1, maxDelayMs: 5 }, isConnectFailure, failure.run),
    ).rejects.toThrow('ECONNREFUSED')

    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
    expect(failure.calls()).toBeGreaterThan(1)
  })

  it('returns as soon as the operation succeeds', async () => {
    let calls = 0

    await expect(
      withRetryUntil(
        1_000,
        { baseDelayMs: 1, maxDelayMs: 2 },
        isConnectFailure,
        async () => {
          calls += 1
          if (calls < 3) throw withCode('ECONNREFUSED')

          return calls
        },
      ),
    ).resolves.toBe(3)
  })
})
