import { z } from 'zod'

import type { CipherGateConfig } from '../config.js'
import { AppError } from '../errors.js'

/**
 * Reads one value out of the secrets store. Names arrive here already decided (a catalog names them), so the store's
 * own naming rules are the caller's business; a name the store does not have is `undefined`, not a failure.
 */
export interface SecretReader {
  read(name: string): Promise<string | undefined>
}

/** What a process without a configured store answers: every name is unknown, and nothing is fetched. */
export const noSecrets: SecretReader = { read: async () => undefined }

/** A store that answers slowly must not hold a request open; a timeout is a store failure like any other. */
const TIMEOUT_MS = 5_000

const secretPath = (name: string): string => `/v1/secret/${encodeURIComponent(name)}`

// The store answers more than this; the value is the only field this module reads, and an empty one is not a secret.
const secretResponse = z.object({ value: z.string().min(1) })

/**
 * The store's REST API: `GET /v1/secret/<NAME>` with the reader consumer's key. 404 means the name is not there (or not
 * granted to this consumer, which the API does not distinguish), so it reads as absent; everything else is the store
 * being unavailable, and the caller sees a 503 rather than an empty credential.
 *
 * The value is never logged and never re-exported except as a credential: this module's only output is the string.
 */
export const createCipherGateSecrets = (
  config: CipherGateConfig,
  request: typeof fetch = fetch,
): SecretReader => ({
  read: async (name) => {
    let response: Response
    try {
      response = await request(`${config.url}${secretPath(name)}`, {
        headers: { authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new AppError(`the secrets store could not be reached: ${reason}`, {
        statusCode: 503,
        code: 'SECRETS_UNAVAILABLE',
      })
    }

    if (response.status === 404) {
      await response.body?.cancel()
      return undefined
    }

    if (!response.ok) {
      // The body may name the failure; it never carries a secret, so it is safe to close without reading it.
      await response.body?.cancel()
      throw new AppError(`the secrets store answered ${response.status} for ${name}`, {
        statusCode: 503,
        code: 'SECRETS_UNAVAILABLE',
      })
    }

    const parsed = secretResponse.safeParse(await response.json())
    if (!parsed.success) {
      throw new AppError(`the secrets store returned no value for ${name}`, {
        statusCode: 503,
        code: 'SECRETS_UNAVAILABLE',
      })
    }

    return parsed.data.value
  },
})
