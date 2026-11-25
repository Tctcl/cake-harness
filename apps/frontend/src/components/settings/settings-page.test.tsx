import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TooltipProvider } from '../ui/tooltip.tsx'
import { SettingsPage } from './settings-page.tsx'

/** The theme control inside Application settings is a tooltip trigger, so the columns render under a provider. */
const renderPage = () =>
  render(
    <TooltipProvider>
      <SettingsPage />
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

  it('opens on the section it is sent to', () => {
    render(
      <TooltipProvider>
        <SettingsPage initialSection="credentials" />
      </TooltipProvider>,
    )

    expect(screen.getByRole('button', { name: 'Credentials' })).toHaveAttribute('aria-current', 'page')
  })

  it('leaves the way out to the window around it', () => {
    renderPage()

    expect(screen.queryByRole('button', { name: /back to conversations/i })).toBeNull()
  })
})
