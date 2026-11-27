import { useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpIcon } from 'lucide-react'

import { Button } from '../ui/button.tsx'
import { Textarea } from '../ui/textarea.tsx'

type PromptInputProps = {
  onSend: (text: string) => void
  label: string
  /** The composer's own controls, in one row under the text: who answers, and how this conversation runs. */
  children?: ReactNode
}

/**
 * The message field: Enter sends, Shift+Enter breaks the line, and the box stays usable while an answer streams so a
 * second thought can be queued. One box holds the words and the controls that decide what answers them, so the accent
 * border of a focused textarea is not a separate element from the settings that shape the run.
 */
export function PromptInput({ onSend, label, children }: PromptInputProps) {
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()

  function submit() {
    if (trimmed === '') return

    onSend(trimmed)
    setDraft('')
  }

  return (
    <form
      className="mx-auto flex w-full max-w-3xl flex-col gap-1 rounded-xl border border-input bg-background p-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Textarea
        aria-label={label}
        className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        placeholder="Ask the agent…"
        rows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          event.preventDefault()
          submit()
        }}
      />
      <div className="flex items-center gap-1.5">
        {/* Wraps at phone widths, and the send button keeps its place at the end of the row. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
        <Button
          type="submit"
          size="icon"
          className="shrink-0"
          aria-label="Send message"
          disabled={trimmed === ''}
        >
          <ArrowUpIcon />
        </Button>
      </div>
    </form>
  )
}
