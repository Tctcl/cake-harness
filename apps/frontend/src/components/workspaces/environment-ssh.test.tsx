import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnvironmentSsh } from './environment-ssh.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('EnvironmentSsh', () => {
  it('renders the workspace config, VS Code link, and remembers an edited identity file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        const body = url.endsWith('/account/ssh-keys')
          ? { keys: [{ id: 'key-1' }] }
          : { ports: [] }

        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
      }),
    )

    render(
      <EnvironmentSsh
        environmentId="environment-1"
        workspaceName="My Project"
        access={{ command: 'ssh -p 22017 dev@ssh.example.test', host: 'ssh.example.test', port: 22017, user: 'dev', running: true }}
        onOpenSshKeys={() => {}}
      />,
    )

    expect(await screen.findByText(/Host cake-my-project/)).toBeInTheDocument()
    expect(screen.getByText(/HostName ssh.example.test/)).toBeInTheDocument()
    expect(screen.getByText(/Port 22017/)).toBeInTheDocument()
    expect(screen.getByText(/IdentityFile ~\/.ssh\/cake_ed25519/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in VS Code' })).toHaveAttribute(
      'href',
      'vscode://vscode-remote/ssh-remote+cake-my-project/home/dev/workspace',
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Identity file path' }), {
      target: { value: '~/.ssh/work-key' },
    })
    expect(screen.getByText(/IdentityFile ~\/.ssh\/work-key/)).toBeInTheDocument()
    expect(window.localStorage.getItem('cake.ssh.identity-file')).toBe('~/.ssh/work-key')
  })

  it('links to Settings when the account has no SSH keys', async () => {
    const onOpenSshKeys = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ keys: [] }) })),
    )

    render(
      <EnvironmentSsh
        environmentId="environment-1"
        workspaceName="Project"
        access={{ command: '', host: 'ssh.example.test', port: 22000, user: 'dev', running: false }}
        onOpenSshKeys={onOpenSshKeys}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Manage keys in Settings/ }))
    expect(onOpenSshKeys).toHaveBeenCalledOnce()
  })
})
