import { useEffect, useState } from 'react'

import { readSettings, updateSettings } from '../../lib/settings-api.ts'
import type { ApplicationSettings as Settings } from '../../lib/settings-api.ts'
import { Button } from '../ui/button.tsx'
import { Label } from '../ui/label.tsx'
import { Textarea } from '../ui/textarea.tsx'

const errorMessage = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'The system prompt could not be saved.'

export function ApplicationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void readSettings().then(
      (loaded) => {
        if (cancelled) return
        setSettings(loaded)
        setPrompt(loaded.systemPrompt)
      },
      (failure: unknown) => {
        if (!cancelled) setError(errorMessage(failure))
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  const save = async (systemPrompt: string): Promise<void> => {
    setBusy(true)
    setSaved(false)
    setError(null)
    try {
      const updated = await updateSettings({ systemPrompt })
      setSettings(updated)
      setPrompt(updated.systemPrompt)
      setSaved(true)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-labelledby="system-prompt-heading">
      <div className="flex flex-col gap-1">
        <h2 id="system-prompt-heading" className="font-medium">System prompt</h2>
        <p className="text-muted-foreground">
          Every agent receives this first, followed by its own system prompt append and instructions.
        </p>
      </div>
      {settings === null ? (
        <p role={error === null ? undefined : 'alert'} className={error === null ? 'text-muted-foreground' : 'text-destructive'}>
          {error ?? 'Loading system prompt…'}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="application-system-prompt">System prompt</Label>
            <Textarea
              id="application-system-prompt"
              rows={12}
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value)
                setSaved(false)
              }}
            />
          </div>
          {error === null ? null : <p role="alert" className="text-destructive">{error}</p>}
          {saved ? <output className="text-muted-foreground">System prompt saved.</output> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void save(prompt)}>
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || prompt === settings.defaultSystemPrompt}
              onClick={() => void save(settings.defaultSystemPrompt)}
            >
              Reset to default
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
