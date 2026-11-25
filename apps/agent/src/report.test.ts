import { describe, expect, it } from 'vitest'

import { reportState } from './report.js'

const STATE_URL = 'http://backend:8080/environments/5d4e3f60-7b8c-4d1e-9f2a-3b4c5d6e7f80/state'

const state = {
  schemaVersion: 1,
  reportedAt: '2026-01-01T00:00:00.000Z',
  tools: [{ id: 'node', version: '26.13.1', path: '/opt/node/bin/node', source: 'installed' }],
} as const

interface Sent {
  readonly url: string
  readonly init: RequestInit | undefined
}

const recorder = (response: Response): { fetch: typeof fetch; sent: Sent[] } => {
  const sent: Sent[] = []

  return {
    sent,
    fetch: async (input, init) => {
      sent.push({ url: String(input), init })

      return response
    },
  }
}

describe('reportState', () => {
  it('puts the report to the state endpoint', async () => {
    const { fetch, sent } = recorder(new Response(null, { status: 204 }))

    await expect(reportState(STATE_URL, state, fetch)).resolves.toEqual({ delivered: true, status: 204 })
    expect(sent[0]?.url).toBe(STATE_URL)
    expect(sent[0]?.init?.method).toBe('PUT')
    expect(sent[0]?.init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual(state)
  })

  it('reports a refusing backend instead of throwing', async () => {
    const { fetch } = recorder(new Response(null, { status: 503 }))

    await expect(reportState(STATE_URL, state, fetch)).resolves.toEqual({ delivered: false, status: 503 })
  })

  it('reports an unreachable backend as no status at all', async () => {
    const failing: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED')
    }

    await expect(reportState(STATE_URL, state, failing)).resolves.toEqual({ delivered: false, status: null })
  })
})
