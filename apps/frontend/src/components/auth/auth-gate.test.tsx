import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SIGNED_OUT_EVENT } from '../../lib/http.ts'
import { AuthGate } from './auth-gate.tsx'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const unauthenticated = () => json(401, { error: { code: 'auth.unauthenticated', message: 'Sign in to continue.' } })

const session = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'admin',
  username: 'admin',
  permissions: [],
  pending: null,
  singleUser: false,
  ...overrides,
})

/** A backend whose session is whatever the last call left it as, answering only the auth routes. */
const backend = (initial: ReturnType<typeof session> | null, password = 'right password') => {
  let current = initial
  const calls: string[] = []
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    if (path === '/auth/session') return current === null ? unauthenticated() : json(200, current)
    if (path === '/auth/login') {
      const body = JSON.parse(String(init?.body)) as { password: string }
      if (body.password !== password) {
        return json(401, { error: { code: 'auth.invalid_credentials', message: 'Wrong username or password.' } })
      }
      current = session()
      return json(200, current)
    }
    if (path === '/auth/logout') {
      current = null
      return new Response(null, { status: 204 })
    }
    if (path === '/auth/2fa/verify') {
      current = session()
      return new Response(null, { status: 204 })
    }

    return json(500, { error: { code: 'INTERNAL_ERROR', message: `unexpected ${path}` } })
  })

  return { fetch, calls }
}

/** What the app would render; the sign-out it was handed is a button so a test can press it. */
const app = (signOut: (() => void) | undefined) => (
  <div>
    <p>the app</p>
    {signOut === undefined ? <p>single user</p> : <button onClick={signOut}>app sign out</button>}
  </div>
)

const signInWith = (password: string) => {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AuthGate', () => {
  it('passes a single-user install straight through, with nothing to sign out of', async () => {
    vi.stubGlobal('fetch', backend(session({ singleUser: true })).fetch)

    render(<AuthGate>{app}</AuthGate>)

    expect(await screen.findByText('the app')).toBeInTheDocument()
    expect(screen.getByText('single user')).toBeInTheDocument()
  })

  it('asks for a password, shows the reason a sign-in failed, and lets the right one in', async () => {
    vi.stubGlobal('fetch', backend(null).fetch)

    render(<AuthGate>{app}</AuthGate>)
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText('the app')).not.toBeInTheDocument()

    signInWith('wrong password')
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.')

    signInWith('right password')
    expect(await screen.findByText('the app')).toBeInTheDocument()
  })

  it('signs out through the backend and shows the form again', async () => {
    const { fetch, calls } = backend(session())
    vi.stubGlobal('fetch', fetch)

    render(<AuthGate>{app}</AuthGate>)
    fireEvent.click(await screen.findByRole('button', { name: 'app sign out' }))

    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument()
    expect(calls).toContain('POST /auth/logout')
  })

  it('takes over when any call reports the session gone', async () => {
    vi.stubGlobal('fetch', backend(session()).fetch)

    render(<AuthGate>{app}</AuthGate>)
    expect(await screen.findByText('the app')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
    })
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('asks for the second factor before the app when the session owes one', async () => {
    vi.stubGlobal('fetch', backend(session({ pending: 'totp' })).fetch)

    render(<AuthGate>{app}</AuthGate>)
    fireEvent.change(await screen.findByLabelText('Code from your authenticator'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText('the app')).toBeInTheDocument()
  })

  it('says so when the backend cannot answer, and tries again on request', async () => {
    const failing = vi.fn(async () => json(503, { error: { code: 'AGENT_UNAVAILABLE', message: 'the agent is unavailable' } }))
    vi.stubGlobal('fetch', failing)

    render(<AuthGate>{app}</AuthGate>)
    expect(await screen.findByRole('alert')).toHaveTextContent('the agent is unavailable')

    vi.stubGlobal('fetch', backend(session()).fetch)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('the app')).toBeInTheDocument()
  })
})
