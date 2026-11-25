/**
 * One reader for every backend call.
 *
 * The backend answers JSON on success and `{ error: { code, message } }` on failure, but a request that never reached it
 * answers neither: a fetch the development proxy does not forward is Vite's `index.html`, and a service that is down
 * answers an empty body. Parsing before looking at the status turned all of that into `Unexpected end of JSON input`,
 * which names the parser instead of the problem. So the status is read first and the body second, and a body that is not
 * JSON is reported as such.
 */

/** The shape the error handler answers; every field is optional because the body may be anything at all. */
const messageOf = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined

  const error: unknown = body.error
  if (typeof error !== 'object' || error === null || !('message' in error)) return undefined

  return typeof error.message === 'string' ? error.message : undefined
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
    const body = await readJson(response)
    throw new Error(messageOf(body) ?? `request failed with status ${response.status}`)
  }

  // 204 carries no body by definition, so there is nothing to parse and nothing to report.
  if (response.status === 204) return undefined as T

  const body = await readJson(response)
  if (body === undefined) {
    throw new Error(`${path} answered ${response.status} with something that is not JSON`)
  }

  return body as T
}
