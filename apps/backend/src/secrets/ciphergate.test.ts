import { describe, expect, it } from 'vitest'

import { AppError } from '../errors.js'
import { createCipherGateSecrets, noSecrets } from './ciphergate.js'

const CONFIG = { url: 'http://ciphergate:8400', token: 'reader-key' }

interface Call {
  readonly url: string
  readonly init: RequestInit | undefined
}

/** A `fetch` that answers one response and records what the reader asked for. */
const recorder = (response: Response): { fetch: typeof fetch; calls: Call[] } => {
  const calls: Call[] = []

  return {
    calls,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init })

      return response
    },
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('createCipherGateSecrets', () => {
  it('reads a secret by name and authenticates with the reader key', async () => {
    const { fetch, calls } = recorder(json({ name: 'GITHUB_TOKEN', value: 'ghp_test' }))
    const secrets = createCipherGateSecrets(CONFIG, fetch)

    await expect(secrets.read('GITHUB_TOKEN')).resolves.toBe('ghp_test')
    expect(calls[0]?.url).toBe('http://ciphergate:8400/v1/secret/GITHUB_TOKEN')
    expect(calls[0]?.init?.headers).toEqual({ authorization: 'Bearer reader-key' })
  })

  it('answers undefined for a name the store does not have', async () => {
    const secrets = createCipherGateSecrets(CONFIG, recorder(json({ error: 'not_found' }, 404)).fetch)

    await expect(secrets.read('NOT_GRANTED')).resolves.toBeUndefined()
  })

  it('reports an unreachable store as a 503 rather than an empty credential', async () => {
    const failing: typeof fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND ciphergate')
    }
    const secrets = createCipherGateSecrets(CONFIG, failing)

    await expect(secrets.read('GITHUB_TOKEN')).rejects.toThrow(AppError)
    await expect(secrets.read('GITHUB_TOKEN')).rejects.toMatchObject({ statusCode: 503, code: 'SECRETS_UNAVAILABLE' })
  })

  it('rejects an answer the store should not have given', async () => {
    const secrets = createCipherGateSecrets(CONFIG, recorder(json({ name: 'GITHUB_TOKEN', value: '' })).fetch)

    await expect(secrets.read('GITHUB_TOKEN')).rejects.toMatchObject({ code: 'SECRETS_UNAVAILABLE' })
  })
})

describe('noSecrets', () => {
  it('knows no names, so nothing is fetched when no store is configured', async () => {
    await expect(noSecrets.read('GITHUB_TOKEN')).resolves.toBeUndefined()
  })
})
