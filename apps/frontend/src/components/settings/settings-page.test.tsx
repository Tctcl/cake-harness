import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '../ui/tooltip.tsx'
import { SettingsPage } from './settings-page.tsx'

/** The theme control inside Application settings is a tooltip trigger, so the columns render under a provider. */
const renderPage = () =>
  render(
    <TooltipProvider>
      <SettingsPage />
    </TooltipProvider>,
  )

const defaultSystemPrompt = 'The built-in Cake system prompt.'
const defaultSubagentSystemPrompt = 'Report results and verification tersely.'
let currentSystemPrompt = defaultSystemPrompt
let currentSubagentSystemPrompt = defaultSubagentSystemPrompt
const settings = () => ({
  singleUser: true,
  requireTwoFactor: false,
  systemPrompt: currentSystemPrompt,
  defaultSystemPrompt,
  subagentSystemPrompt: currentSubagentSystemPrompt,
  defaultSubagentSystemPrompt,
})

beforeEach(() => {
  currentSystemPrompt = defaultSystemPrompt
  currentSubagentSystemPrompt = defaultSubagentSystemPrompt
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body !== undefined) {
        const patch = JSON.parse(String(init.body)) as { systemPrompt?: string; subagentSystemPrompt?: string }
        if (patch.systemPrompt !== undefined) currentSystemPrompt = patch.systemPrompt
        if (patch.subagentSystemPrompt !== undefined) currentSubagentSystemPrompt = patch.subagentSystemPrompt
      }

      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(settings()) })
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

describe('SettingsPage', () => {
  it('opens on application settings and holds only the app and the user', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Application settings' })).toBeDefined()
    for (const label of ['Application settings', 'Credentials', 'SSH keys', 'Account']) {
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

  it('saves the app-owned base prompt and resets it to the built-in default', async () => {
    const fetch = vi.mocked(globalThis.fetch)
    renderPage()

    const prompt = await screen.findByRole('textbox', { name: 'System prompt' })
    fireEvent.change(prompt, { target: { value: 'A custom system prompt.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save system prompt' }))

    await screen.findByRole('status')
    expect(fetch).toHaveBeenLastCalledWith('/settings', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ systemPrompt: 'A custom system prompt.' }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Reset system prompt to default' }))
    await waitFor(() => expect(prompt).toHaveValue(defaultSystemPrompt))
    expect(fetch).toHaveBeenLastCalledWith('/settings', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ systemPrompt: defaultSystemPrompt }),
    }))
  })

  it('saves the sub agent prompt and resets it independently', async () => {
    const fetch = vi.mocked(globalThis.fetch)
    renderPage()

    const prompt = await screen.findByRole('textbox', { name: 'Sub agent system prompt' })
    fireEvent.change(prompt, { target: { value: 'Return facts, paths and checks only.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save sub agent system prompt' }))

    await screen.findByText('Sub agent system prompt saved.')
    expect(fetch).toHaveBeenLastCalledWith('/settings', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ subagentSystemPrompt: 'Return facts, paths and checks only.' }),
    }))
    expect(screen.getByRole('textbox', { name: 'System prompt' })).toHaveValue(defaultSystemPrompt)

    fireEvent.click(screen.getByRole('button', { name: 'Reset sub agent system prompt to default' }))
    await waitFor(() => expect(prompt).toHaveValue(defaultSubagentSystemPrompt))
    expect(fetch).toHaveBeenLastCalledWith('/settings', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ subagentSystemPrompt: defaultSubagentSystemPrompt }),
    }))
  })
})
