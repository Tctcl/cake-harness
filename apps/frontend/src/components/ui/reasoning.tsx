/* oxlint-disable react-refresh/only-export-components -- vendored AI Elements component: the hook and its parts ship together */
import { Streamdown } from 'streamdown'
import { BrainIcon, ChevronDownIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { createContext, memo, useCallback, useContext, useEffect, useRef, useState } from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

/**
 * The answer's reasoning, as AI Elements ships it (`@ai-elements/reasoning`), with two deliberate reductions: the
 * shimmer is the stylesheet's `.shimmer` class instead of a motion component, and the content renders through plain
 * `streamdown` rather than pulling the cjk, math and mermaid plugins in for text the model reasons in.
 */

interface ReasoningContextValue {
  readonly isStreaming: boolean
  readonly isOpen: boolean
  readonly setIsOpen: (open: boolean) => void
  readonly duration: number | undefined
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null)

export const useReasoning = (): ReasoningContextValue => {
  const context = useContext(ReasoningContext)
  if (context === null) throw new Error('Reasoning components must be used within Reasoning')

  return context
}

/** A value the caller may own (`prop`) or leave to the component (`local`), for the open state and the measured time. */
const useControllable = <T,>(
  prop: T | undefined,
  initial: T,
  onChange?: (value: T) => void,
): [T, (value: T) => void] => {
  const [local, setLocal] = useState<T>(initial)

  const set = useCallback(
    (value: T) => {
      if (prop === undefined) setLocal(value)
      onChange?.(value)
    },
    [prop, onChange],
  )

  return [prop ?? local, set]
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  readonly isStreaming?: boolean
  readonly open?: boolean
  readonly defaultOpen?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly duration?: number
}

const AUTO_CLOSE_DELAY = 1000
const MS_IN_S = 1000

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    // A user who closed the panel means it: streaming does not force it back open.
    const isExplicitlyClosed = defaultOpen === false

    const [isOpen, setIsOpen] = useControllable<boolean>(
      open,
      defaultOpen ?? isStreaming,
      onOpenChange,
    )
    const [duration, setDuration] = useControllable<number | undefined>(durationProp, undefined)

    const hasEverStreamed = useRef(isStreaming)
    const [hasAutoClosed, setHasAutoClosed] = useState(false)
    const startedAt = useRef<number | null>(null)

    useEffect(() => {
      if (isStreaming) {
        hasEverStreamed.current = true
        startedAt.current ??= Date.now()

        return
      }
      if (startedAt.current === null) return

      setDuration(Math.ceil((Date.now() - startedAt.current) / MS_IN_S))
      startedAt.current = null
    }, [isStreaming, setDuration])

    useEffect(() => {
      if (isStreaming && !isOpen && !isExplicitlyClosed) setIsOpen(true)
    }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed])

    // Collapse once the reasoning has landed, so a finished answer is not pushed down by what it took to write it.
    useEffect(() => {
      if (!hasEverStreamed.current || isStreaming || !isOpen || hasAutoClosed) return

      const timer = setTimeout(() => {
        setIsOpen(false)
        setHasAutoClosed(true)
      }, AUTO_CLOSE_DELAY)

      return () => clearTimeout(timer)
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed])

    const contextValue = {
      duration,
      isOpen,
      isStreaming,
      setIsOpen,
    }

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn('not-prose mb-4', className)}
          onOpenChange={setIsOpen}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    )
  },
)

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  readonly getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode
}

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number): ReactNode => {
  if (isStreaming || duration === 0) return <span className="shimmer">Thinking…</span>
  if (duration === undefined) return <span>Thought for a few seconds</span>

  return <span>Thought for {duration} seconds</span>
}

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning()

    return (
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground',
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon className="size-4" />
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDownIcon
              className={cn('size-4 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')}
            />
          </>
        )}
      </CollapsibleTrigger>
    )
  },
)

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  readonly children: string
}

export const ReasoningContent = memo(({ className, children, ...props }: ReasoningContentProps) => (
  <CollapsibleContent
    className={cn(
      'mt-4 text-sm',
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-muted-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
      className,
    )}
    {...props}
  >
    <Streamdown>{children}</Streamdown>
  </CollapsibleContent>
))

Reasoning.displayName = 'Reasoning'
ReasoningTrigger.displayName = 'ReasoningTrigger'
ReasoningContent.displayName = 'ReasoningContent'
