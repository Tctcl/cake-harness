import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Credential } from '../../lib/credentials-api.ts'
import { CredentialsPage } from './credentials-page.tsx'

const credential = (overrides: Partial<Credential>): Credential => ({
  id: 'credential-1',
  kind: 'opencode-go',
  name: 'work',
  expiresAt: null,
  email: 'me@example.com',
  note: null,
  mcpId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

/** Only the list is stubbed by default: a write is asserted by the request the page sends, not by a reply. */
const stubFetch = (credentials: readonly Credential[], status = 200) => {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(init === undefined ? { url } : { url, init })

    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(url === '/credentials' && init === undefined ? { credentials } : {}),
    })
  })
  vi.stubGlobal('fetch', fetchMock)

  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CredentialsPage', () => {
  beforeEach(() => {
    stubFetch([credential({}), credential({ id: 'credential-2', kind: 'mcp', name: 'github-pat', email: null, mcpId: 'github' })])
  })

  it('splits the list by kind and shows no secret', async () => {
    render(<CredentialsPage />)

    expect(await screen.findByText(/OpenCode Go API keys/)).toBeDefined()
    expect(screen.getByText(/MCP auth keys/)).toBeDefined()
    expect(screen.getAllByText('work')).not.toHaveLength(0)
    expect(screen.getByText('me@example.com')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /github-pat/ }))
    expect(screen.getByText('github')).toBeDefined()
    expect(screen.getAllByText(/Never expires/).length).toBeGreaterThanOrEqual(2)
  })

  it('asks a provider key for its account and its expiry', async () => {
    const calls = stubFetch([])

    render(<CredentialsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'New credential' }))
    expect(screen.getByLabelText('Account email')).toBeDefined()
    expect(screen.queryByLabelText('MCP id')).toBeNull()

    fireEvent.change(screen.getByLabelText('Key name'), { target: { value: 'work' } })
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'sk-1' } })
    fireEvent.change(screen.getByLabelText('Account email'), { target: { value: 'me@example.com' } })
    fireEvent.change(screen.getByLabelText('Expiration date'), { target: { value: '2027-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add credential' }))

    await waitFor(() => expect(calls.some((call) => call.init?.method === 'POST')).toBe(true))
    const posted = calls.find((call) => call.init?.method === 'POST')
    expect(JSON.parse(String(posted?.init?.body))).toMatchObject({
      kind: 'opencode-go',
      name: 'work',
      value: 'sk-1',
      email: 'me@example.com',
      // A key that expires on a day lasts through it.
      expiresAt: '2027-01-31T23:59:59.999Z',
    })
  })

  it('asks an mcp key for the server id and a note, and leaves the expiry open', async () => {
    const calls = stubFetch([])

    render(<CredentialsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'New credential' }))
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'mcp' } })
    expect(screen.queryByLabelText('Account email')).toBeNull()

    fireEvent.change(screen.getByLabelText('Key name'), { target: { value: 'github-pat' } })
    fireEvent.change(screen.getByLabelText('MCP id'), { target: { value: 'github' } })
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'personal' } })
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'ghp_1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add credential' }))

    await waitFor(() => expect(calls.some((call) => call.init?.method === 'POST')).toBe(true))
    const posted = calls.find((call) => call.init?.method === 'POST')
    expect(JSON.parse(String(posted?.init?.body))).toMatchObject({
      kind: 'mcp',
      mcpId: 'github',
      note: 'personal',
      expiresAt: null,
    })
  })

  it('deletes a key from its own row', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        calls.push(init === undefined ? { url } : { url, init })

        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ credentials: [credential({})] }),
        })
      }),
    )

    render(<CredentialsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete work' }))

    await waitFor(() => expect(calls.some((call) => call.init?.method === 'DELETE')).toBe(true))
    expect(calls.find((call) => call.init?.method === 'DELETE')?.url).toBe('/credentials/credential-1')
  })
})
