import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '../ui/tooltip.tsx'
import { SettingsPage } from './settings-page.tsx'

/** The theme control inside Application settings is a tooltip trigger, so the screen renders under a provider. */
const renderPage = (onClose: () => void = () => {}) =>
  render(
    <TooltipProvider>
      <SettingsPage onClose={onClose} />
    </TooltipProvider>,
  )

describe('SettingsPage', () => {
  it('opens on application settings and holds only the app and the user', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Application settings' })).toBeDefined()
    for (const label of ['Application settings', 'Credentials', 'Account']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
    // What belongs to a workspace is edited in the workspace manager, not here.
    for (const label of ['Tools', 'Skills', 'Prompts', 'MCPs', 'Workspaces']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }
    expect(screen.getByText('Theme')).toBeDefined()
  })

  it('leaves the screen through one control', () => {
    const onClose = vi.fn()
    renderPage(onClose)

    fireEvent.click(screen.getByRole('button', { name: /back to conversations/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
