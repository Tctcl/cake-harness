import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { CredentialDocument } from './contract.js'

const ENV_FILE = join('.config', 'dev-env', 'credentials.env')

export interface AppliedCredentials {
  readonly ids: readonly string[]
  /** Where the env entries were written, or `null` when nothing had env entries. */
  readonly envFile: string | null
  readonly files: readonly string[]
}

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const expandHome = (path: string, home: string): string => {
  if (path === '~') {
    return home
  }
  if (path.startsWith('~/')) {
    return join(home, path.slice(2))
  }
  return path
}

/**
 * Values land in `0600` files owned by the development user, never in the
 * bootstrap's own environment: a child process inherits that environment, and an
 * agent that runs `env` would print the secret into a transcript.
 */
const writeSecretFile = (path: string, content: string, mode: number, home: string): string => {
  const target = expandHome(path, home)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  writeFileSync(target, content, { mode })
  chmodSync(target, mode)
  return target
}

/**
 * Materialises the backend-supplied credentials for the development user. Returns
 * ids and paths only — the caller has nowhere to put a value and needs none.
 */
export const applyCredentials = (document: CredentialDocument, home: string): AppliedCredentials => {
  const envLines: string[] = []
  const files: string[] = []

  for (const credential of document.credentials) {
    for (const [name, value] of Object.entries(credential.env)) {
      envLines.push(`export ${name}=${quote(value)}`)
    }
    for (const file of credential.files) {
      files.push(writeSecretFile(file.path, file.content, Number.parseInt(file.mode, 8), home))
    }
  }

  let envFile: string | null = null
  if (envLines.length > 0) {
    envFile = writeSecretFile(join(home, ENV_FILE), `${envLines.join('\n')}\n`, 0o600, home)
  }

  return { ids: document.credentials.map((credential) => credential.id), envFile, files }
}
