import { HttpError, request } from './http.ts'

/** The step a half-signed-in session still has to take before anything else answers. */
export type PendingStep = 'password' | 'totp-setup' | 'totp'

/** Who the browser is signed in as; in single-user mode the backend answers the owner without a cookie. */
export interface Session {
  readonly id: string
  readonly name: string
  readonly username: string | null
  readonly permissions: readonly string[]
  readonly pending: PendingStep | null
  readonly singleUser: boolean
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** The current session, or `null` when nobody is signed in. Any other failure is not an answer and propagates. */
export const readSession = async (): Promise<Session | null> => {
  try {
    return await request<Session>('/auth/session')
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return null
    throw error
  }
}

export const signIn = async (username: string, password: string): Promise<Session> =>
  await request<Session>('/auth/login', post({ username, password }))

export const signOut = async (): Promise<void> => {
  await request('/auth/logout', post({}))
}

/** The second factor of a session whose `pending` is `totp`. */
export const verifySecondFactor = async (code: string): Promise<void> => {
  await request('/auth/2fa/verify', post({ code }))
}

/** Replaces a password an admin chose, for a session whose `pending` is `password`. */
export const setInitialPassword = async (password: string): Promise<void> => {
  await request('/auth/password/initial', post({ password }))
}
