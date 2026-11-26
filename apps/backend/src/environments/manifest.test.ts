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
      content: 'prefix=/home/dev/.local\n//registry.npmjs.org/:_authToken=npm_test\n',
    })
  })

  it('includes user-selected packages, git identity and a user-owned GitHub token', async () => {
    const manifest = await buildManifest(noSecrets, {
      tooling: [{ kind: 'apt', name: 'jq', version: 'latest' }, { kind: 'npm', name: 'cowsay', version: '1.6.0' }],
      githubToken: 'ghp_user',
      gitIdentity: { name: 'A Developer', email: 'dev@example.com' },
    })

    expect(manifest.tooling.tools.slice(1)).toEqual([
      { id: 'apt:jq', kind: 'apt', name: 'jq', version: 'latest' },
      { id: 'npm:cowsay', kind: 'npm', name: 'cowsay', version: '1.6.0' },
    ])
    const github = manifest.credentials.credentials.find((entry) => entry.id === 'github')
    expect(github?.env).toEqual({ GH_TOKEN: 'ghp_user', GITHUB_TOKEN: 'ghp_user' })
    expect(github?.files.map((file) => file.path)).toEqual(['~/.config/gh/hosts.yml', '~/.gitconfig'])
    expect(github?.files[1]?.content).toContain('name = "A Developer"')
    expect(github?.files[1]?.content).toContain('helper = !gh auth git-credential')
  })

  it('drops a credential whose secret is missing instead of failing the boot', async () => {
    const manifest = await buildManifest(readerOf({ NPM_TOKEN: 'npm_test' }))

    expect(manifest.credentials.credentials.map((entry) => entry.id)).toEqual(['npm'])
  })
})
