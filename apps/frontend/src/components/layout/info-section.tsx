import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.tsx'

type InfoSectionProps = {
  title: string
  /** Folds its body shut on mount. The panel is read top-down, and not every section is needed every time. */
  startClosed?: boolean
  children: ReactNode
}

/**
 * One block of the info panel. There is no box around it: sections are separated by a rule that stops short of the
 * sidebar's edges, so the rail reads as one column rather than as a stack of framed cards.
 */
function InfoSection({ title, startClosed = false, children }: InfoSectionProps) {
  const [open, setOpen] = useState(!startClosed)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground">
        <ChevronDown className={`size-3 transition-transform ${open ? '' : '-rotate-90'}`} />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** The rule between two sections, inset by the panel's padding so it never spans the whole sidebar. */
function SectionRule() {
  return <div className="h-px w-full bg-border" />
}

export { InfoSection, SectionRule }
