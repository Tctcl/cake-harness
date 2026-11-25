import { describe, expect, it } from 'vitest'

import { fetchDocuments } from './documents.js'

const MANIFEST_URL = 'http://backend:8080/environments/5d4e3f60-7b8c-4d1e-9f2a-3b4c5d6e7f80/manifest'

const manifest = {
  tooling: { schemaVersion: 1, tools: [{ id: 'node', version: '26.13.1' }] },
  credentials: {
    schemaVersion: 1,
    credentials: [
      {
        id: 'github',
        env: { GH_TOKEN: 'ghp_test' },
        files: [],
      },
    ],
  },
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('fetchDocuments', () => {
  it('validates both documents out of one manifest', async () => {
    const documents = await fetchDocuments(MANIFEST_URL, null, async () => json(manifest))

    expect(documents.tooling.tools).toEqual([{ id: 'node', version: '26.13.1' }])
    expect(documents.credentials.credentials[0]?.id).toBe('github')
  })

  it('asks for JSON and bounds the wait', async () => {
    let seen: RequestInit | undefined
    await fetchDocuments(MANIFEST_URL, null, async (_input, init) => {
      seen = init
      return json(manifest)
    })

    expect(seen?.headers).toEqual({ accept: 'application/json' })
    expect(seen?.signal).toBeDefined()
  })

  it('proves which environment it is with the bearer token', async () => {
    let seen: RequestInit | undefined
    await fetchDocuments(MANIFEST_URL, 'env-token', async (_input, init) => {
      seen = init
      return json(manifest)
    })

    expect(seen?.headers).toEqual({ accept: 'application/json', authorization: 'Bearer env-token' })
  })

  it('fails with the reason when the manifest cannot be read', async () => {
    await expect(fetchDocuments(MANIFEST_URL, null, async () => json({ error: 'nope' }, 500))).rejects.toThrow(
      /cannot read .*: 500/,
    )
  })

  it('refuses a manifest without one of the documents', async () => {
    await expect(fetchDocuments(MANIFEST_URL, null, async () => json({ tooling: manifest.tooling }))).rejects.toThrow(
      /tooling and credentials/,
    )
  })

  it('validates the credential document too, not just the tooling', async () => {
    const broken = {
      ...manifest,
      credentials: {
        schemaVersion: 1,
        credentials: [
          { id: 'npm', env: {}, files: [{ path: '~/.npmrc', mode: '06000', content: 'x' }] },
        ],
      },
    }

    await expect(fetchDocuments(MANIFEST_URL, null, async () => json(broken))).rejects.toThrow(
      /mode must be an octal permission string/,
    )
  })
})
