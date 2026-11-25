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

/** Replaces the signed-in account's password; every other session of the account is signed out. */
export const changePassword = async (current: string, next: string): Promise<void> => {
  await request('/auth/password/change', post({ current, next }))
}

/** The account as the user list shows it; read for the account's own second-factor state. */
export interface AccountRow {
  readonly id: string
  readonly username: string | null
  readonly name: string
  readonly totp: boolean
}

/** The user list, or `null` when this account may not read it (only admins may). */
export const listAccounts = async (): Promise<AccountRow[] | null> => {
  try {
    return await request<AccountRow[]>('/users')
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) return null
    throw error
  }
}

/** Starts enrolment: the secret to type into an authenticator app, and the same as an `otpauth://` link. */
export const startSecondFactor = async (): Promise<{ readonly secret: string; readonly uri: string }> =>
  await request('/auth/2fa/setup', post({}))

/** Finishes enrolment with a code the authenticator shows. */
export const enableSecondFactor = async (code: string): Promise<void> => {
  await request('/auth/2fa/enable', post({ code }))
}

/** Turns the second factor off; guarded by the password, and it signs out every session. */
export const disableSecondFactor = async (password: string): Promise<void> => {
  await request('/auth/2fa/disable', post({ password }))
}
