import { readFileSync } from 'node:fs'

/** Where the backend's documents are mounted for this container. */
const DEFAULT_CONFIG_DIR = '/etc/dev-env'

export interface BootstrapConfig {
  readonly configDir: string
}

export const readBootstrapConfig = (env: NodeJS.ProcessEnv): BootstrapConfig => {
  const configDir = env['DEV_ENV_CONFIG_DIR']?.trim() ?? ''
  return { configDir: configDir.length === 0 ? DEFAULT_CONFIG_DIR : configDir }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Reads and validates one document. Configuration enters the process here, so
 * this is where a malformed file has to stop the boot rather than surface later
 * as a missing tool the reconciler cannot explain.
 */
export const loadJsonDocument = <T>(path: string, parse: (value: unknown) => T): T => {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${path}: ${messageOf(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${messageOf(error)}`)
  }

  return parse(parsed)
}
