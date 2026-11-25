import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceOverview } from './workspace-overview.tsx'

const general = {
  id: 'workspace-1',
  name: 'General',
  description: '',
  isDefault: true,
  allowAll: true,
  position: 0,
}

afterEach(() => vi.unstubAllGlobals())

describe('WorkspaceOverview General guards', () => {
  it('explains both disabled controls without calling the API', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<WorkspaceOverview workspace={general} onChanged={() => {}} />)

    const reach = screen.getByRole('checkbox', { name: 'Reach every capability' })
    expect(reach.getAttribute('aria-disabled')).toBe('true')
    expect(reach.hasAttribute('disabled')).toBe(false)
    fireEvent.click(reach)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'General always reaches everything it can use; this cannot be changed.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    const archive = screen.getByRole('button', { name: 'Archive workspace' })
    expect(archive.getAttribute('aria-disabled')).toBe('true')
    expect(archive.hasAttribute('disabled')).toBe(false)
    fireEvent.click(archive)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'General is the default workspace and cannot be archived.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
