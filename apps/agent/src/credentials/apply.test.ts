import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applyCredentials } from './apply.js'
import type { CredentialDocument } from './contract.js'

const document: CredentialDocument = {
  schemaVersion: 1,
  credentials: [
    {
      id: 'github',
      env: { GH_TOKEN: "ghp_with'a_quote" },
      files: [{ path: '~/.config/gh/hosts.yml', mode: '0600', content: 'github.com:\n' }],
    },
    { id: 'npm', env: {}, files: [{ path: '~/.npmrc', mode: '0600', content: 'token=x\n' }] },
  ],
}

const npmOnly: CredentialDocument = {
  schemaVersion: 1,
  credentials: [{ id: 'npm', env: {}, files: [{ path: '~/.npmrc', mode: '0600', content: 'token=x\n' }] }],
}

const tempHome = (): string => mkdtempSync(join(tmpdir(), 'dev-env-'))

describe('applyCredentials', () => {
  it('writes env entries to a single sourced file and expands ~ for files', () => {
    const home = tempHome()
    const applied = applyCredentials(document, home)

    expect(applied.ids).toEqual(['github', 'npm'])
    if (applied.envFile === null) {
      throw new Error('expected an env file for a document with env entries')
    }
    expect(applied.envFile).toBe(join(home, '.config', 'dev-env', 'credentials.env'))
    expect(applied.files).toEqual([join(home, '.config', 'gh', 'hosts.yml'), join(home, '.npmrc')])
    expect(readFileSync(join(home, '.npmrc'), 'utf8')).toBe('token=x\n')
  })

  it('quotes a value containing a single quote so the file stays valid shell', () => {
    const home = tempHome()
    const applied = applyCredentials(document, home)
    if (applied.envFile === null) {
      throw new Error('expected an env file for a document with env entries')
    }

    expect(readFileSync(applied.envFile, 'utf8')).toBe("export GH_TOKEN='ghp_with'\\''a_quote'\n")
  })

  it('writes no env file when no credential carries env entries', () => {
    const home = tempHome()
    const applied = applyCredentials(npmOnly, home)

    expect(applied.envFile).toBeNull()
    expect(applied.files).toEqual([join(home, '.npmrc')])
  })

  it('never returns a value, only ids and paths', () => {
    const applied = applyCredentials(document, tempHome())

    expect(Object.keys(applied)).toEqual(['ids', 'envFile', 'files'])
    expect(JSON.stringify(applied)).not.toContain('ghp_with')
  })
})
