import { XIcon } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'

import { Button } from '../ui/button.tsx'

/**
 * A window over the chat, the way a desktop app's settings dialog covers the document behind it. The native `<dialog>`
 * is what makes it a modal: `showModal()` brings the browser's own focus trap, Escape handling and backdrop.
 *
 * Below `md` it fills the screen, because a window with margins on a phone is just a worse page.
 */
export function OverlayWindow({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  // jsdom has no `showModal`: there the window is an `open` dialog, without the browser's key handling behind it.
  const modal = useRef(false)
  const titleId = useId()
  // The listeners are attached once, so they read the latest `onClose` through a ref rather than being re-bound.
  const close = useRef(onClose)

  useEffect(() => {
    close.current = onClose
  }, [onClose])

  useEffect(() => {
    const element = dialog.current
    if (element === null) return

    // Read before the window takes focus, so closing puts the user back on the control that opened it.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const dismiss = (): void => close.current()

    // A modal dialog's Escape arrives as `cancel`; the state, not the element, is what closes the window.
    const cancel = (event: Event): void => {
      event.preventDefault()
      dismiss()
    }
    // The fallback dialog is not modal, so it gets no `cancel` event and has to read the key itself.
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || modal.current) return
      event.preventDefault()
      dismiss()
    }
    // The content fills the dialog, so a click that lands on the dialog is a click on the backdrop around it.
    const backdrop = (event: MouseEvent): void => {
      if (event.target === element) dismiss()
    }

    element.addEventListener('cancel', cancel)
    element.addEventListener('keydown', escape)
    element.addEventListener('click', backdrop)

    if (typeof element.showModal === 'function') {
      element.showModal()
      modal.current = true
    } else {
      element.setAttribute('open', '')
    }
    // The window itself, not its first control: the title is what should be announced on arrival.
    element.focus()

    return () => {
      element.removeEventListener('cancel', cancel)
      element.removeEventListener('keydown', escape)
      element.removeEventListener('click', backdrop)
      modal.current = false

      if (typeof element.close === 'function') element.close()
      else element.removeAttribute('open')
      opener?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="m-auto h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-background p-0 text-foreground shadow-2xl outline-none backdrop:bg-black/50 md:h-[80vh] md:w-[min(960px,calc(100vw-4rem))] md:rounded-xl md:border"
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <h2 id={titleId} className="text-sm font-medium">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label={`Close ${title}`}
            onClick={() => close.current()}
          >
            <XIcon aria-hidden />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </dialog>
  )
}
