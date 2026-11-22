import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '../ui/tooltip.tsx'
import { SettingsPage } from './settings-page.tsx'

const user = { id: '00000000-0000-4000-8000-000000000001', name: 'Local user' }

// Every catalog section loads itself on mount, so the screen needs a backend that answers with empty lists.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ servers: [], tools: [], entries: [] }) })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The theme control inside Application settings is a tooltip trigger, so the screen renders under a provider. */
const renderPage = (onClose: () => void = () => {}) =>
  render(
    <TooltipProvider>
      <SettingsPage user={user} onClose={onClose} />
    </TooltipProvider>,
  )

describe('SettingsPage', () => {
  it('opens on application settings and lists every section', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Application settings' })).toBeDefined()
    for (const label of ['Tools', 'Skills', 'Prompts', 'MCPs', 'Application settings', 'User admin']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
    expect(screen.getByText('Theme')).toBeDefined()
  })

  it('draws the catalog for a capability section instead of a placeholder', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'MCPs' }))

    expect(screen.getByRole('heading', { name: 'MCP servers' })).toBeDefined()
    expect(screen.getByText(/one server can be reached with different secrets/i)).toBeDefined()
    expect(screen.getByText('New server')).toBeDefined()
    expect(screen.getByRole('button', { name: 'MCPs' }).getAttribute('aria-current')).toBe('page')
  })

  it('names the local user the sessions belong to', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'User admin' }))

    expect(screen.getByText('Local user')).toBeDefined()
    expect(screen.getByText(user.id)).toBeDefined()
    expect(screen.getByText(/until sign-in exists/i)).toBeDefined()
  })

  it('leaves the screen through one control', () => {
    const onClose = vi.fn()
    renderPage(onClose)

    fireEvent.click(screen.getByRole('button', { name: /back to conversations/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
