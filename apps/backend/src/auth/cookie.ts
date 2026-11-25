/** The one cookie the app sets. Named with the product so a shared domain does not collide with something else. */
export const SESSION_COOKIE = 'cake_session'

/** `name=value` pairs, split by hand: one cookie is not worth a dependency and `@fastify/cookie` is one. */
export const readCookie = (header: string | undefined, name: string): string | undefined => {
  if (header === undefined) return undefined

  for (const pair of header.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    if (pair.slice(0, index).trim() !== name) continue

    return decodeURIComponent(pair.slice(index + 1).trim())
  }

  return undefined
}

/**
 * `HttpOnly` keeps the token away from script, `SameSite=Lax` keeps another site from spending it, and `Secure` is
 * only meaningful over https — set it always and plain-http development loses the cookie silently.
 */
export const sessionCookie = (token: string, secure: boolean, maxAgeSeconds: number): string =>
  [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`]
    .concat(secure ? ['Secure'] : [])
    .join('; ')

export const clearedSessionCookie = (secure: boolean): string =>
  [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'].concat(secure ? ['Secure'] : []).join('; ')
