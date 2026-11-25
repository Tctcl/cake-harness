/**
 * The OpenCode Go inference API, called by the backend rather than by the browser: the key stays on the server, and the
 * endpoint is rate limited by whichever account the key belongs to.
 *
 * Only two facts are taken from the documentation as fixed — an invalid key answers `401`, and a key the plan does not
 * cover answers `403` with an `EntitlementError`. Everything else is read defensively: a response field this file does
 * not expect must leave a value `null`, not turn a page that wanted a model list into a 500.
 */

const BASE_URL = 'https://opencode.ai/inference/go/v1'

/** Long enough for a slow list, short enough that a page load is not held by an upstream nobody is answering. */
const TIMEOUT_MS = 10_000

/** One model as the catalog serves it, which is what a workspace allows and an agent runs. */
export interface UpstreamModel {
  /** Provider-qualified, e.g. `anthropic/claude-sonnet-4`. */
  readonly id: string
  readonly name: string
  readonly contextWindow: number | null
  readonly maxOutput: number | null
  readonly inputUsdPerMillion: number | null
  readonly outputUsdPerMillion: number | null
  readonly supportsReasoning: boolean
  readonly supportsTools: boolean
}

/** Why a key was refused, so the route can say which one it was instead of "bad request". */
export type ProviderKeyProblem = 'invalid' | 'entitlement' | 'unavailable'

export type ProviderKeyCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: ProviderKeyProblem; readonly message: string }

const json = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined

/** A list from whichever envelope the endpoint used; anything else is an empty list, not an exception. */
const listOf = (body: unknown): readonly unknown[] => {
  if (Array.isArray(body)) return body

  const object = json(body)
  for (const key of ['data', 'models', 'items']) {
    const value = object?.[key]
    if (Array.isArray(value)) return value
  }

  return []
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const flag = (value: unknown): boolean => value === true

const toModel = (entry: unknown): UpstreamModel | undefined => {
  const source = json(entry)
  if (source === undefined) return undefined

  const id = text(source['id'])
  if (id === undefined) return undefined

  const pricing = json(source['pricing'] ?? source['cost'])
  const capabilities = json(source['capabilities'])

  // Each field is read under every spelling the endpoint has been documented with, then narrowed to its type.
  return {
    id,
    name: text(source['name']) ?? id,
    contextWindow: number(source['contextWindow'] ?? source['context_window'] ?? source['context_length']),
    maxOutput: number(source['maxOutput'] ?? source['max_output_tokens'] ?? source['maxOutputTokens']),
    inputUsdPerMillion: number(pricing?.['input']),
    outputUsdPerMillion: number(pricing?.['output']),
    supportsReasoning: flag(capabilities?.['reasoning'] ?? source['supportsReasoning'] ?? source['reasoning']),
    supportsTools: flag(capabilities?.['tools'] ?? source['supportsTools'] ?? source['tools']),
  }
}

/** `undefined` when the request never produced a response: a lookup that cannot be tried is not a refused key. */
const get = async (path: string, key: string): Promise<Response | undefined> => {
  try {
    return await fetch(`${BASE_URL}${path}`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return undefined
  }
}

const bodyOf = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * Whether the provider accepts this key. The usage endpoint is the cheapest one that goes through the same
 * authentication, so a key is proven before it is stored rather than on the first turn that tries to spend it.
 */
export const checkKey = async (key: string): Promise<ProviderKeyCheck> => {
  const response = await get('/usage', key)

  if (response === undefined) {
    return { ok: false, problem: 'unavailable', message: 'the provider could not be reached' }
  }

  if (response.ok) return { ok: true }

  if (response.status === 401) {
    return { ok: false, problem: 'invalid', message: 'the provider rejected the key' }
  }

  if (response.status === 403) {
    const body = json(await bodyOf(response))
    const error = json(body?.['error'])
    const detail = text(error?.['message']) ?? text(error?.['type'])

    return {
      ok: false,
      problem: 'entitlement',
      message: detail === undefined ? 'the key is not covered by the plan' : `the key is not covered by the plan: ${detail}`,
    }
  }

  return { ok: false, problem: 'unavailable', message: `the provider answered ${response.status}` }
}

/** The models this key can reach, or `undefined` when the endpoint could not be read at all. */
export const fetchModels = async (key: string): Promise<readonly UpstreamModel[] | undefined> => {
  const response = await get('/models', key)
  if (response === undefined || !response.ok) return undefined

  return listOf(await bodyOf(response))
    .map(toModel)
    .filter((model): model is UpstreamModel => model !== undefined)
}
