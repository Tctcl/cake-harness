import { describe, expect, it } from 'vitest'

import type { SecretReader } from '../secrets/ciphergate.js'
import { noSecrets } from '../secrets/ciphergate.js'
import { buildManifest } from './manifest.js'

/** A store that has exactly the values given, and reads nothing else. */
const readerOf = (values: Readonly<Record<string, string>>): SecretReader => ({
  read: async (name) => values[name],
})

describe('buildManifest', () => {
  it('serves the tooling the repository pins, with no store involved', async () => {
    const manifest = await buildManifest(noSecrets)

    expect(manifest.tooling).toEqual({ schemaVersion: 1, tools: [{ id: 'node', version: '26.13.1' }] })
    expect(manifest.credentials).toEqual({ schemaVersion: 1, credentials: [] })
  })

  it('turns each stored secret into the credential that carries it', async () => {
    const manifest = await buildManifest(readerOf({ GITHUB_TOKEN: 'ghp_test', NPM_TOKEN: 'npm_test' }))

    expect(manifest.credentials.credentials).toHaveLength(2)

    const github = manifest.credentials.credentials.find((entry) => entry.id === 'github')
    expect(github?.env).toEqual({ GH_TOKEN: 'ghp_test', GITHUB_TOKEN: 'ghp_test' })

    const npm = manifest.credentials.credentials.find((entry) => entry.id === 'npm')
    expect(npm?.files[0]).toEqual({
      path: '~/.npmrc',
      mode: '0600',
      content: '//registry.npmjs.org/:_authToken=npm_test\n',
    })
  })

  it('drops a credential whose secret is missing instead of failing the boot', async () => {
    const manifest = await buildManifest(readerOf({ NPM_TOKEN: 'npm_test' }))

    expect(manifest.credentials.credentials.map((entry) => entry.id)).toEqual(['npm'])
  })
})
