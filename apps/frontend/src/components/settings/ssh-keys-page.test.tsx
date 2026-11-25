import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SshKeysPage } from './ssh-keys-page.tsx'

afterEach(() => vi.unstubAllGlobals())

describe('SshKeysPage', () => {
  it('generates a key, displays the private half once, and offers its suggested download name', async () => {
    const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-material\n-----END OPENSSH PRIVATE KEY-----\n'
    const key = {
      id: 'key-1',
      name: 'Laptop',
      publicKey: 'ssh-ed25519 AAAA',
      fingerprint: 'SHA256:fingerprint',
      createdAt: new Date(0).toISOString(),
    }
    let hasKey = false
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        let body: unknown
        if (url.endsWith('/generate')) {
          hasKey = true
          body = { key, privateKey, filename: 'cake_ed25519' }
        } else {
          body = { keys: hasKey ? [key] : [] }
        }

        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
      }),
    )

    render(<SshKeysPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'New SSH key' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Key name' }), { target: { value: 'Laptop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate a key' }))

    expect(await screen.findByRole('textbox', { name: 'Generated private key' })).toHaveValue(privateKey)
    expect(screen.getByText('Cake does not keep this; store it in ~/.ssh.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download cake_ed25519' })).toHaveAttribute('download', 'cake_ed25519')
    expect(screen.getAllByText('SHA256:fingerprint')).toHaveLength(2)
  })
})
