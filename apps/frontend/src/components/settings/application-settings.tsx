import { useEffect, useState } from 'react'

import { readSettings, updateSettings } from '../../lib/settings-api.ts'
import type { ApplicationSettings as Settings } from '../../lib/settings-api.ts'
import { Button } from '../ui/button.tsx'
import { Label } from '../ui/label.tsx'
import { Textarea } from '../ui/textarea.tsx'
import { BackgroundModelSettings } from './background-model-settings.tsx'

type PromptField = 'systemPrompt' | 'subagentSystemPrompt'

const errorMessage = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'The prompt could not be saved.'

export function ApplicationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [prompts, setPrompts] = useState<Record<PromptField, string>>({ systemPrompt: '', subagentSystemPrompt: '' })
  const [busy, setBusy] = useState<PromptField | null>(null)
  const [error, setError] = useState<{ readonly field: PromptField; readonly message: string } | null>(null)
  const [saved, setSaved] = useState<PromptField | null>(null)

  useEffect(() => {
    let cancelled = false
    void readSettings().then(
      (loaded) => {
        if (cancelled) return
        setSettings(loaded)
        setPrompts({ systemPrompt: loaded.systemPrompt, subagentSystemPrompt: loaded.subagentSystemPrompt })
      },
      (failure: unknown) => {
        if (!cancelled) setError({ field: 'systemPrompt', message: errorMessage(failure) })
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  const save = async (field: PromptField, value: string): Promise<void> => {
    setBusy(field)
    setSaved(null)
    setError(null)
    try {
      const updated = await updateSettings(
        field === 'systemPrompt' ? { systemPrompt: value } : { subagentSystemPrompt: value },
      )
      setSettings(updated)
      setPrompts({ systemPrompt: updated.systemPrompt, subagentSystemPrompt: updated.subagentSystemPrompt })
      setSaved(field)
    } catch (failure) {
      setError({ field, message: errorMessage(failure) })
    } finally {
      setBusy(null)
    }
  }

  if (settings === null) {
    return (
      <section className="flex flex-col gap-3 rounded-md border p-4" aria-labelledby="system-prompt-heading">
        <h2 id="system-prompt-heading" className="font-medium">System prompt</h2>
        <p
          role={error === null ? undefined : 'alert'}
          className={error === null ? 'text-muted-foreground' : 'text-destructive'}
        >
          {error?.message ?? 'Loading system prompts…'}
        </p>
      </section>
    )
  }

  return (
    <>
      <PromptEditor
        label="System prompt"
        headingId="system-prompt-heading"
        inputId="application-system-prompt"
        description="Every ordinary agent receives this first, followed by its own system prompt append and instructions."
        value={prompts.systemPrompt}
        defaultValue={settings.defaultSystemPrompt}
        busy={busy !== null}
        error={error?.field === 'systemPrompt' ? error.message : null}
        saved={saved === 'systemPrompt'}
        onChange={(value) => {
          setPrompts((current) => ({ ...current, systemPrompt: value }))
          setSaved(null)
        }}
        onSave={(value) => void save('systemPrompt', value)}
      />
      <BackgroundModelSettings initialChain={settings.backgroundModel ?? []} />
      <PromptEditor
        label="Sub agent system prompt"
        headingId="subagent-system-prompt-heading"
        inputId="application-subagent-system-prompt"
        description="Every delegation receives this instead of the ordinary agent prompt, followed by the sub agent’s own prompt and instructions."
        value={prompts.subagentSystemPrompt}
        defaultValue={settings.defaultSubagentSystemPrompt}
        busy={busy !== null}
        error={error?.field === 'subagentSystemPrompt' ? error.message : null}
        saved={saved === 'subagentSystemPrompt'}
        onChange={(value) => {
          setPrompts((current) => ({ ...current, subagentSystemPrompt: value }))
          setSaved(null)
        }}
        onSave={(value) => void save('subagentSystemPrompt', value)}
      />
    </>
  )
}

/** One independently saved global prompt; the two fields share behavior without sharing dirty or success state. */
function PromptEditor({
  label,
  headingId,
  inputId,
  description,
  value,
  defaultValue,
  busy,
  error,
  saved,
  onChange,
  onSave,
}: {
  readonly label: string
  readonly headingId: string
  readonly inputId: string
  readonly description: string
  readonly value: string
  readonly defaultValue: string
  readonly busy: boolean
  readonly error: string | null
  readonly saved: boolean
  readonly onChange: (value: string) => void
  readonly onSave: (value: string) => void
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-labelledby={headingId}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="font-medium">{label}</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>{label}</Label>
        <Textarea id={inputId} rows={12} value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
      {error === null ? null : <p role="alert" className="text-destructive">{error}</p>}
      {saved ? <output className="text-muted-foreground">{label} saved.</output> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          aria-label={`Save ${label.toLowerCase()}`}
          disabled={busy}
          onClick={() => onSave(value)}
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Reset ${label.toLowerCase()} to default`}
          disabled={busy || value === defaultValue}
          onClick={() => onSave(defaultValue)}
        >
          Reset to default
        </Button>
      </div>
    </section>
  )
}
