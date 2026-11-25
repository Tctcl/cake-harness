/**
 * One reader for every backend call.
 *
 * The backend answers JSON on success and `{ error: { code, message } }` on failure, but a request that never reached it
 * answers neither: a fetch the development proxy does not forward is Vite's `index.html`, and a service that is down
 * answers an empty body. Parsing before looking at the status turned all of that into `Unexpected end of JSON input`,
 * which names the parser instead of the problem. So the status is read first and the body second, and a body that is not
 * JSON is reported as such.
 */

/** A failed call, with the status and the backend's stable code so a caller can tell a refusal from a fault. */
export class HttpError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code: string | undefined) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

/**
 * Fired when the backend says the session is gone (expired, signed out elsewhere, or the account disabled), so the
 * sign-in gate can take over from whichever screen made the call instead of each screen showing its own 401.
 */
export const SIGNED_OUT_EVENT = 'cake:signed-out'

/** The shape the error handler answers; every field is optional because the body may be anything at all. */
const errorOf = (body: unknown): { readonly message?: string; readonly code?: string } => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return {}

  const error: unknown = body.error
  if (typeof error !== 'object' || error === null) return {}

  return {
    ...('message' in error && typeof error.message === 'string' ? { message: error.message } : {}),
    ...('code' in error && typeof error.code === 'string' ? { code: error.code } : {}),
  }
}

/** The body as JSON, or `undefined` when it is not JSON: an HTML error page must not read as a parse failure. */
const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init)

  if (!response.ok) {
    const { message, code } = errorOf(await readJson(response))
    if (response.status === 401 && code === 'auth.unauthenticated') window.dispatchEvent(new Event(SIGNED_OUT_EVENT))

    throw new HttpError(message ?? `request failed with status ${response.status}`, response.status, code)
  }

  // 204 carries no body by definition, so there is nothing to parse and nothing to report.
  if (response.status === 204) return undefined as T

  const body = await readJson(response)
  if (body === undefined) {
    throw new Error(`${path} answered ${response.status} with something that is not JSON`)
  }

  return body as T
}
