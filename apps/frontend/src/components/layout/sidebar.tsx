import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

import { Button } from '../ui/button.tsx'

type SidebarSide = 'left' | 'right'

const MIN_WIDTH = 160
const MAX_WIDTH = 480
const MAIN_MIN_WIDTH = 320

type WidthProps = {
  side: SidebarSide
  width: number
  otherWidth: number
  onWidthChange: (width: number) => void
}

function clampWidth(next: number, otherWidth: number) {
  const available = window.innerWidth - otherWidth - MAIN_MIN_WIDTH

  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next, Math.min(next, available))))
}

type SidebarProps = WidthProps & {
  label: string
  onCollapse: () => void
}

function Sidebar({ side, label, width, onCollapse }: SidebarProps) {
  const border = side === 'left' ? 'border-r' : 'border-l'

  return (
    <aside
      className={`flex shrink-0 flex-col ${border} bg-sidebar text-sidebar-foreground`}
      style={{ width }}
      aria-label={`${label} sidebar`}
    >
      <div className="flex h-12 shrink-0 items-center px-4 text-sm font-medium">
        <span>{label}</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          aria-label={`Collapse ${label} sidebar`}
          onClick={onCollapse}
        >
          {side === 'left' ? <ChevronLeft /> : <ChevronRight />}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4" />
    </aside>
  )
}

type SidebarRailProps = {
  side: SidebarSide
  label: string
  onExpand: () => void
}

function SidebarRail({ side, label, onExpand }: SidebarRailProps) {
  const border = side === 'left' ? 'border-r' : 'border-l'

  return (
    <button
      type="button"
      className={`flex w-4 shrink-0 items-start justify-center ${border} bg-sidebar pt-3.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`}
      aria-label={`Expand ${label} sidebar`}
      onClick={onExpand}
    >
      {side === 'left' ? (
        <ChevronRight className="size-3" />
      ) : (
        <ChevronLeft className="size-3" />
      )}
    </button>
  )
}

function ResizeHandle({
  side,
  width,
  otherWidth,
  onWidthChange,
  onCollapse,
}: WidthProps & { onCollapse: () => void }) {
  const dragStart = useRef<{ x: number; width: number } | null>(null)

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = { x: event.clientX, width }
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = dragStart.current
    if (!start) return

    const delta = event.clientX - start.x
    const next = side === 'left' ? start.width + delta : start.width - delta
    onWidthChange(clampWidth(next, otherWidth))
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragStart.current = null
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
    if (step === 0) return

    event.preventDefault()
    // ArrowRight always grows the left sidebar and shrinks the right one.
    const grows = side === 'left' ? step > 0 : step < 0
    onWidthChange(clampWidth(width + (grows ? 16 : -16), otherWidth))
  }

  return (
    <button
      type="button"
      aria-label={`Resize ${side} sidebar`}
      className="m-0 h-full w-1 shrink-0 cursor-col-resize touch-none border-0 bg-border transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onDoubleClick={onCollapse}
    />
  )
}

export { ResizeHandle, Sidebar, SidebarRail }
