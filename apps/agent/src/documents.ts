import type { CredentialDocument } from './credentials/contract.js'
import { parseCredentialDocument } from './credentials/parse.js'
import type { ToolingConfig } from './tooling/contract.js'
import { parseDesiredTooling } from './tooling/parse.js'

/** How long a document request may take before the boot gives up on it. */
const TIMEOUT_MS = 5_000

/** Both documents a container needs, as served in one manifest. */
export interface BootstrapDocuments {
  readonly tooling: ToolingConfig
  readonly credentials: CredentialDocument
}

/** The two document slots of a manifest, before either has been validated. */
interface ManifestFields {
  readonly tooling: unknown
  readonly credentials: unknown
}

const fieldsOf = (body: unknown): ManifestFields => {
  if (typeof body !== 'object' || body === null || !('tooling' in body) || !('credentials' in body)) {
    throw new Error('manifest must be an object carrying tooling and credentials')
  }

  return { tooling: body.tooling, credentials: body.credentials }
}

/**
 * Fetches the manifest and validates both documents. Everything the container
 * installs or authenticates with enters the process here.
 */
export const fetchDocuments = async (url: string, fetchFn: typeof fetch = fetch): Promise<BootstrapDocuments> => {
  const response = await fetchFn(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`cannot read ${url}: ${response.status} ${response.statusText}`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    throw new Error(`${url} did not answer with JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const fields = fieldsOf(body)

  return {
    tooling: parseDesiredTooling(fields.tooling),
    credentials: parseCredentialDocument(fields.credentials),
  }
}
