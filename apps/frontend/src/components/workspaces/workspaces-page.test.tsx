import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspacesPage } from './workspaces-page.tsx'

const workspace = { id: 'workspace-1', name: 'Platform', description: 'The product', isDefault: true, allowAll: false }

type Handler = (url: string) => unknown

const stubFetch = (handler: Handler) =>
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = handler(url)

      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    }),
  )

beforeEach(() => {
  stubFetch((url) => (url.includes('/workspaces') ? { workspaces: [workspace] } : {}))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WorkspacesPage', () => {
  it('lists the workspaces and holds a placeholder until one is picked', async () => {
    render(<WorkspacesPage onOpenCredentials={() => {}} />)

    expect(await screen.findByRole('button', { name: /platform/i })).toBeDefined()
    expect(screen.getByText('No workspace selected')).toBeDefined()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('opens the workspace on its overview tab and switches tabs from there', async () => {
    render(<WorkspacesPage onOpenCredentials={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: /platform/i }))

    const tabs = screen.getByRole('tablist', { name: /platform settings/i })
    expect(tabs).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    for (const label of ['Environment', 'MCP', 'Skills', 'Prompts', 'Tools', 'Providers']) {
      expect(screen.getByRole('tab', { name: label })).toBeDefined()
    }

    fireEvent.click(screen.getByRole('tab', { name: 'MCP' }))

    expect(screen.getByText('New server')).toBeDefined()
    expect(screen.getByRole('tab', { name: 'MCP' }).getAttribute('aria-selected')).toBe('true')
  })

  it('starts the next workspace on its overview rather than on the previous one’s tab', async () => {
    const other = { id: 'workspace-2', name: 'Sandbox', description: '', isDefault: false, allowAll: true }
    stubFetch((url) => (url.includes('/workspaces') ? { workspaces: [workspace, other] } : {}))
    render(<WorkspacesPage onOpenCredentials={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: /platform/i }))
    fireEvent.click(screen.getByRole('tab', { name: 'Providers' }))
    fireEvent.click(screen.getByRole('button', { name: /sandbox/i }))

    expect(screen.getByRole('tablist', { name: /sandbox settings/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Providers' }).getAttribute('aria-selected')).toBe('false')
  })

  it('keeps Add workspace usable and points at the name when it is empty', async () => {
    render(<WorkspacesPage onOpenCredentials={() => {}} />)

    const add = await screen.findByRole('button', { name: /add workspace/i })
    expect(add).toBeEnabled()

    fireEvent.click(add)

    expect(screen.getByRole('alert')).toHaveTextContent('Name the workspace first')
    expect(screen.getByLabelText('New workspace name')).toHaveFocus()
  })

  it('leaves the way out to the window around it', async () => {
    render(<WorkspacesPage onOpenCredentials={() => {}} />)

    await screen.findByRole('button', { name: /platform/i })

    expect(screen.queryByRole('button', { name: /back to conversations/i })).toBeNull()
  })
})
