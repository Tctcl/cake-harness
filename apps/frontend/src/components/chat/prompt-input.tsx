import { useState } from 'react'
import { ArrowUpIcon } from 'lucide-react'

import { Button } from '../ui/button.tsx'
import { Textarea } from '../ui/textarea.tsx'

type PromptInputProps = {
  onSend: (text: string) => void
  label: string
}

/**
 * The message field: Enter sends, Shift+Enter breaks the line, and the box stays usable while an answer streams so a
 * second thought can be queued.
 */
export function PromptInput({ onSend, label }: PromptInputProps) {
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()

  function submit() {
    if (trimmed === '') return

    onSend(trimmed)
    setDraft('')
  }

  return (
    <form
      className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border border-input bg-background p-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Textarea
        aria-label={label}
        className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        placeholder="Ask the agent"
        rows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          event.preventDefault()
          submit()
        }}
      />
      <Button type="submit" size="icon" aria-label="Send message" disabled={trimmed === ''}>
        <ArrowUpIcon />
      </Button>
    </form>
  )
}
