import { ChevronDown, ChevronUp } from 'lucide-react'

import { Button } from '../ui/button.tsx'

type TopNavProps = {
  onToggle: () => void
}

function TopNav({ onToggle }: TopNavProps) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b bg-sidebar px-4 text-sm text-sidebar-foreground">
      <span>topnav</span>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto size-7"
        aria-label="Collapse top nav"
        onClick={onToggle}
      >
        <ChevronUp />
      </Button>
    </header>
  )
}

function CollapsedTopNav({ onToggle }: TopNavProps) {
  return (
    <header className="relative h-2.5 shrink-0 border-b bg-sidebar">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-0 right-0 h-2.5 w-10 rounded-none text-muted-foreground"
        aria-label="Expand top nav"
        onClick={onToggle}
      >
        <ChevronDown className="size-2.5" />
      </Button>
    </header>
  )
}

export { CollapsedTopNav, TopNav }
