/** Where the record of everything reconciliation installed lives. */
const DEFAULT_INSTALL_RECORD = '/var/lib/dev-env/installed.json'

export interface BootstrapConfig {
  /** The environment's manifest, served by the backend. Required: there is nothing to reconcile without it. */
  readonly manifestUrl: string
  /** Where the report goes back to. Absent means the environment runs without a backend to tell. */
  readonly stateUrl: string | null
  /** What reconciliation installed last time, so a recorded install is not mistaken for an image tool. */
  readonly installRecordPath: string
}

const requireUrl = (name: string, raw: string | undefined): string | null => {
  const value = raw?.trim() ?? ''
  if (value.length === 0) {
    return null
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} is not a URL: ${value}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must be http or https, got ${url.protocol}`)
  }

  return url.toString()
}

/**
 * Reads the whole environment once, at startup. The container has no other
 * configuration: what it installs and who may log in both arrive over the wire.
 */
export const readBootstrapConfig = (env: NodeJS.ProcessEnv): BootstrapConfig => {
  const manifestUrl = requireUrl('DEV_ENV_MANIFEST_URL', env['DEV_ENV_MANIFEST_URL'])
  if (manifestUrl === null) {
    throw new Error('DEV_ENV_MANIFEST_URL is required')
  }

  const recordPath = env['DEV_ENV_INSTALL_RECORD']?.trim() ?? ''

  return {
    manifestUrl,
    stateUrl: requireUrl('DEV_ENV_STATE_URL', env['DEV_ENV_STATE_URL']),
    installRecordPath: recordPath.length === 0 ? DEFAULT_INSTALL_RECORD : recordPath,
  }
}
