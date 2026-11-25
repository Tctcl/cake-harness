import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { OverlayWindow } from './overlay-window.tsx'

const window = (title = 'Settings') => screen.getByRole('dialog', { name: title })

describe('OverlayWindow', () => {
  it('is a window labelled by its title', () => {
    render(
      <OverlayWindow title="Settings" onClose={() => {}}>
        <p>Window body</p>
      </OverlayWindow>,
    )

    expect(window('Settings')).toBeInTheDocument()
    expect(screen.getByText('Window body')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <OverlayWindow title="Settings" onClose={onClose}>
        <p>Window body</p>
      </OverlayWindow>,
    )

    fireEvent.keyDown(window(), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes from its close control', () => {
    const onClose = vi.fn()
    render(
      <OverlayWindow title="Workspaces" onClose={onClose}>
        <p>Window body</p>
      </OverlayWindow>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close Workspaces' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes on a click on the backdrop around it', () => {
    const onClose = vi.fn()
    render(
      <OverlayWindow title="Settings" onClose={onClose}>
        <p>Window body</p>
      </OverlayWindow>,
    )

    // The content fills the window, so the window itself is only reachable around it.
    fireEvent.click(window())

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('takes the focus and gives it back to the control that opened it', () => {
    function Harness() {
      const [open, setOpen] = useState(false)

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open settings
          </button>
          {open ? (
            <OverlayWindow title="Settings" onClose={() => setOpen(false)}>
              <p>Window body</p>
            </OverlayWindow>
          ) : null}
        </>
      )
    }

    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open settings' })
    opener.focus()
    fireEvent.click(opener)

    expect(window()).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
