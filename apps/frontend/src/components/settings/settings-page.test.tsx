import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
let currentBackgroundModel: readonly unknown[] = []
const settings = () => ({
  singleUser: true,
  requireTwoFactor: false,
  systemPrompt: currentSystemPrompt,
  defaultSystemPrompt,
  subagentSystemPrompt: currentSubagentSystemPrompt,
  defaultSubagentSystemPrompt,
  backgroundModel: currentBackgroundModel,
})

beforeEach(() => {
  currentSystemPrompt = defaultSystemPrompt
  currentSubagentSystemPrompt = defaultSubagentSystemPrompt
  currentBackgroundModel = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (input === '/providers/logins') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ logins: [
          { id: 'key-one', provider: 'opencode-go', label: 'First key', createdAt: '2026-01-01T00:00:00Z' },
          { id: 'key-two', provider: 'opencode-go', label: 'Second key', createdAt: '2026-01-01T00:00:00Z' },
        ] }) })
      }
      if (input === '/providers/models') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ models: [
          { id: 'model-one', name: 'First model' },
          { id: 'model-two', name: 'Second model' },
        ] }) })
      }
      if (init?.body !== undefined) {
        const patch = JSON.parse(String(init.body)) as {
          systemPrompt?: string
          subagentSystemPrompt?: string
          backgroundModel?: readonly unknown[]
        }
        if (patch.systemPrompt !== undefined) currentSystemPrompt = patch.systemPrompt
        if (patch.subagentSystemPrompt !== undefined) currentSubagentSystemPrompt = patch.subagentSystemPrompt
        if (patch.backgroundModel !== undefined) currentBackgroundModel = patch.backgroundModel
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

  it('adds, reorders and saves the background model chain', async () => {
    const fetch = vi.mocked(globalThis.fetch)
    renderPage()

    const add = await screen.findByRole('button', { name: 'Add entry' })
    await waitFor(() => expect(add).toBeEnabled())
    fireEvent.click(add)
    fireEvent.click(add)
    fireEvent.change(screen.getByRole('combobox', { name: 'Key 2' }), { target: { value: 'key-two' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Model 2' }), { target: { value: 'model-two' } })

    const secondRow = screen.getByRole('combobox', { name: 'Key 2' }).closest('li')
    if (secondRow === null) throw new Error('the second background entry is missing')
    fireEvent.click(within(secondRow).getByRole('button', { name: 'Move up' }))
    expect(screen.getByRole('combobox', { name: 'Key 1' })).toHaveValue('key-two')

    fireEvent.click(screen.getByRole('button', { name: 'Save background model' }))
    await screen.findByText('Background model saved.')
    expect(fetch).toHaveBeenLastCalledWith('/settings', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ backgroundModel: [
        { credentialId: 'key-two', modelId: 'model-two', thinkingLevel: 'off' },
        { credentialId: 'key-one', modelId: 'model-one', thinkingLevel: 'off' },
      ] }),
    }))
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

  it('says both prompts only steer conversations that have not started', async () => {
    renderPage()

    const prompt = await screen.findByRole('textbox', { name: 'System prompt' })
    const editor = prompt.closest('section')
    if (editor === null) throw new Error('the prompt editor is missing')
    expect(within(editor).getByText(
      'Applies to new conversations; running ones keep the text they started with.',
    )).toBeInTheDocument()

    const subagent = screen.getByRole('textbox', { name: 'Sub agent system prompt' })
    const subagentEditor = subagent.closest('section')
    if (subagentEditor === null) throw new Error('the sub agent prompt editor is missing')
    expect(within(subagentEditor).getByText(
      'Applies to new conversations; running ones keep the text they started with.',
    )).toBeInTheDocument()
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
