import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { Button } from '../ui/button.tsx'
import { ScrollArea } from '../ui/scroll-area.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.tsx'

type SidebarSide = 'left' | 'right'

const MAIN_MIN_WIDTH = 320

/**
 * What a sidebar's resize is allowed to produce and what it opens at. Each sidebar names its own: a terminal wants room
 * the conversation list does not, and the width it opens at is a decision of the screen that owns it, not of the handle.
 */
type SidebarWidths = {
  readonly min: number
  readonly max: number
  readonly open: number
}

type WidthProps = {
  side: SidebarSide
  widths: SidebarWidths
  width: number
  otherWidth: number
  onWidthChange: (width: number) => void
}

function clampWidth(next: number, otherWidth: number, widths: SidebarWidths) {
  const available = window.innerWidth - otherWidth - MAIN_MIN_WIDTH

  return Math.round(Math.min(widths.max, Math.max(widths.min, next, Math.min(next, available))))
}

type SidebarProps = WidthProps & {
  title: string
  action?: ReactNode
  children: ReactNode
  /** Pinned below the scrolling list: the control that belongs to the sidebar as a whole, not to its contents. */
  footer?: ReactNode
  onCollapse: () => void
}

function Sidebar({ side, title, action, children, footer, width, onCollapse }: SidebarProps) {
  const border = side === 'left' ? 'border-r' : 'border-l'

  return (
    <aside
      className={`flex shrink-0 flex-col ${border} bg-sidebar text-sidebar-foreground`}
      style={{ width }}
      aria-label={title}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 px-4 text-sm font-medium">
        <span className="truncate">{title}</span>
        {action}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-7"
              aria-label={`Collapse ${title}`}
              onClick={onCollapse}
            >
              {side === 'left' ? <ChevronLeft /> : <ChevronRight />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={side === 'left' ? 'right' : 'left'}>
            Collapse {title.toLowerCase()}
          </TooltipContent>
        </Tooltip>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col p-2">{children}</div>
      </ScrollArea>
      {footer === undefined ? null : (
        <div className="shrink-0 border-t p-2">{footer}</div>
      )}
    </aside>
  )
}

type SidebarRailProps = {
  side: SidebarSide
  title: string
  onExpand: () => void
}

function SidebarRail({ side, title, onExpand }: SidebarRailProps) {
  const border = side === 'left' ? 'border-r' : 'border-l'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`flex w-4 shrink-0 items-start justify-center ${border} bg-sidebar pt-3.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`}
          aria-label={`Expand ${title}`}
          onClick={onExpand}
        >
          {side === 'left' ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronLeft className="size-3" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side === 'left' ? 'right' : 'left'}>Expand {title.toLowerCase()}</TooltipContent>
    </Tooltip>
  )
}

function ResizeHandle({
  side,
  widths,
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
    onWidthChange(clampWidth(next, otherWidth, widths))
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
    onWidthChange(clampWidth(width + (grows ? 16 : -16), otherWidth, widths))
  }

  return (
    <button
      type="button"
      aria-label={`Resize ${side} sidebar`}
      // The line itself is the 1px border of the sidebar it borders on; this strip is only the grab area, so dragging
      // is comfortable without the separator growing to the width of the handle.
      className="m-0 h-full w-1 shrink-0 cursor-col-resize touch-none border-0 bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none"
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
export type { SidebarWidths }
