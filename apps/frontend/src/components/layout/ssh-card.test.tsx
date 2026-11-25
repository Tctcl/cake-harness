import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SshCard } from './ssh-card.tsx'

/** The two endpoints answer different shapes, so the stub branches on the path rather than on a caller's guess. */
const stubFetch = ({ access, tunnels }: { access: unknown; tunnels?: readonly unknown[] }) =>
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(String(input).endsWith('/ssh/tunnels') ? { tunnels: tunnels ?? [] } : access),
      }),
    ),
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SshCard', () => {
  it('shows how to reach the container and what is forwarded through it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        const body = url.endsWith('/ssh/tunnels')
          ? { tunnels: [{ id: 't1', command: 'ssh -L 5432:localhost:5432 dev@127.0.0.1 -p 2222', localPort: 5432, remotePort: 5432 }] }
          : { command: 'ssh dev@127.0.0.1 -p 2222', host: '127.0.0.1', port: 2222, user: 'dev' }

        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
      }),
    )

    render(<SshCard environmentId="environment-1" />)

    expect(await screen.findByText('ssh dev@127.0.0.1 -p 2222')).toBeInTheDocument()
    expect(screen.getByText('dev@127.0.0.1, port 2222')).toBeInTheDocument()
    expect(screen.getByText('ssh -L 5432:localhost:5432 dev@127.0.0.1 -p 2222')).toBeInTheDocument()
  })

  it('copies a command to the clipboard', async () => {
    stubFetch({ access: { command: 'ssh dev@127.0.0.1 -p 2222', host: '127.0.0.1', port: 2222, user: 'dev' } })
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

    render(<SshCard environmentId="environment-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy SSH command' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ssh dev@127.0.0.1 -p 2222'))
    expect(screen.getByText('Copied')).toBeInTheDocument()
  })

  it('says so when the container has no ssh access yet', async () => {
    stubFetch({ access: null })

    render(<SshCard environmentId="environment-1" />)

    expect(await screen.findByText('No SSH access for this container yet.')).toBeInTheDocument()
  })
})
