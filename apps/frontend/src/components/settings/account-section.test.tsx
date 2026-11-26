import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AccountSection } from './account-section.tsx'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const session = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'admin',
  username: 'admin',
  permissions: [],
  pending: null,
  singleUser: false,
  ...overrides,
})

/** Answers the account routes; records what was posted so a test can check the call. */
const backend = (state: { session: ReturnType<typeof session>; totp: boolean }) => {
  const posted: { path: string; body: unknown }[] = []
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PUT') posted.push({ path, body: JSON.parse(String(init.body)) })
    if (path === '/auth/session') return json(200, state.session)
    if (path === '/account/git' && init === undefined) return json(200, { name: 'Initial Name', email: 'initial@example.com' })
    if (path === '/account/git' && init?.method === 'PUT') return json(200, JSON.parse(String(init.body)))
    if (path === '/users') return json(200, [{ id: 'u1', username: 'admin', name: 'admin', totp: state.totp }])
    if (path === '/auth/password/change') {
      const body = JSON.parse(String(init?.body)) as { current: string }
      return body.current === 'right password!'
        ? new Response(null, { status: 204 })
        : json(401, { error: { code: 'auth.invalid_credentials', message: 'Wrong password.' } })
    }
    if (path === '/auth/2fa/setup') return json(200, { secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/cake:admin' })
    if (path === '/auth/2fa/enable') return new Response(null, { status: 204 })

    return json(500, { error: { code: 'INTERNAL_ERROR', message: `unexpected ${path}` } })
  })

  return { fetch, posted }
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AccountSection', () => {
  it('says plainly when the install has no sign-in at all', async () => {
    vi.stubGlobal('fetch', backend({ session: session({ singleUser: true }), totp: false }).fetch)

    render(<AccountSection />)

    expect(await screen.findByRole('region', { name: 'Single-user mode' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument()
  })

  it('saves the git identity delivered to workspace containers', async () => {
    const { fetch, posted } = backend({ session: session(), totp: false })
    vi.stubGlobal('fetch', fetch)
    render(<AccountSection />)

    await screen.findByLabelText('Name')
    type('Name', 'A Developer')
    type('Email', 'dev@example.com')
    fireEvent.click(await screen.findByRole('button', { name: 'Save git identity' }))

    expect(await screen.findByText(/Git identity saved/)).toBeInTheDocument()
    expect(posted.at(-1)).toEqual({
      path: '/account/git',
      body: { name: 'A Developer', email: 'dev@example.com' },
    })
  })

  it('changes the password, and shows why it was refused', async () => {
    const { fetch, posted } = backend({ session: session(), totp: false })
    vi.stubGlobal('fetch', fetch)
    render(<AccountSection />)

    expect(await screen.findByText('admin', { selector: 'span' })).toBeInTheDocument()
    type('Current password', 'wrong password!')
    type('New password', 'a brand new password')
    type('Repeat new password', 'a brand new password')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password.')

    type('Current password', 'right password!')
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument()
    expect(posted.at(-1)).toEqual({
      path: '/auth/password/change',
      body: { current: 'right password!', next: 'a brand new password' },
    })
  })

  it('will not submit two new passwords that differ', async () => {
    vi.stubGlobal('fetch', backend({ session: session(), totp: false }).fetch)
    render(<AccountSection />)

    await screen.findByLabelText('Current password')
    type('New password', 'a brand new password')
    type('Repeat new password', 'something else entirely')

    expect(screen.getByText('The two do not match.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled()
  })

  it('enrols an authenticator: shows the secret, then turns it on with a code', async () => {
    const { fetch, posted } = backend({ session: session(), totp: false })
    vi.stubGlobal('fetch', fetch)
    render(<AccountSection />)

    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()

    type('Code from the app', '123456')
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))

    expect(await screen.findByText('Two-factor sign-in is on.')).toBeInTheDocument()
    expect(posted.at(-1)).toEqual({ path: '/auth/2fa/enable', body: { code: '123456' } })
  })
})
