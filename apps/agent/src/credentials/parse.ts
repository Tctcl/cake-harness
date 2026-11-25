import type { Credential, CredentialDocument, CredentialFile } from './contract.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireRecord = (value: unknown, where: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`)
  }
  return value
}

const requireString = (value: unknown, where: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where} must be a non-empty string`)
  }
  return value
}

const requireArray = (value: unknown, where: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${where} must be an array`)
  }
  return value
}

const parseEnv = (value: unknown, where: string): Record<string, string> => {
  const record = requireRecord(value, where)
  const env: Record<string, string> = {}
  for (const [name, variable] of Object.entries(record)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new Error(`${where} has an invalid variable name: ${JSON.stringify(name)}`)
    }
    env[name] = requireString(variable, `${where}.${name}`)
  }
  return env
}

const parseFile = (value: unknown, where: string): CredentialFile => {
  const record = requireRecord(value, where)
  const mode = requireString(record['mode'], `${where}.mode`)
  if (!/^0?[0-7]{3}$/.test(mode)) {
    throw new Error(`${where}.mode must be an octal permission string such as 0600, got ${JSON.stringify(mode)}`)
  }
  return {
    path: requireString(record['path'], `${where}.path`),
    mode,
    content: requireString(record['content'], `${where}.content`),
  }
}

const parseCredential = (value: unknown, where: string): Credential => {
  const record = requireRecord(value, where)
  return {
    id: requireString(record['id'], `${where}.id`),
    env: parseEnv(record['env'] ?? {}, `${where}.env`),
    files: requireArray(record['files'] ?? [], `${where}.files`).map((file, index) =>
      parseFile(file, `${where}.files[${index}]`),
    ),
  }
}

/**
 * Validates the document the backend serves. Values are never logged and never
 * reported back; the caller only ever re-exports credential ids.
 */
export const parseCredentialDocument = (value: unknown): CredentialDocument => {
  const record = requireRecord(value, 'credential document')
  if (record['schemaVersion'] !== 1) {
    throw new Error(`credential document.schemaVersion must be 1, got ${JSON.stringify(record['schemaVersion'])}`)
  }
  return {
    schemaVersion: 1,
    credentials: requireArray(record['credentials'], 'credential document.credentials').map((credential, index) =>
      parseCredential(credential, `credential document.credentials[${index}]`),
    ),
  }
}
