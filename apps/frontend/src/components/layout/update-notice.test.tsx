import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UpdateNotice } from './update-notice.tsx'

const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

const status = {
  channel: 'production',
  current: '0.2.0',
  latest: '0.3.0',
  url: 'https://github.com/Tctcl/tlabs-platform/releases/tag/v0.3.0',
  available: true,
  checkedAt: '2026-01-01T00:00:00.000Z',
  error: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('UpdateNotice', () => {
  it('links to the release page when a newer release exists', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(status)))

    render(<UpdateNotice />)

    const link = await screen.findByRole('link', { name: /Update to 0\.3\.0/ })
    expect(link).toHaveAttribute('href', status.url)
    expect(link).toHaveAttribute('title', 'This install runs 0.2.0')
  })

  it('renders nothing when the install is current', async () => {
    const fetch = vi.fn(() => reply({ ...status, available: false, latest: null }))
    vi.stubGlobal('fetch', fetch)

    const { container } = render(<UpdateNotice />)

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the answer is not knowable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ ...status, available: null, latest: null })))

    const { container } = render(<UpdateNotice />)

    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders nothing when the check cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

    const { container } = render(<UpdateNotice />)

    // The rejection is caught: a convenience must not take the shell down with it.
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
