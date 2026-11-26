import { useEffect, useState } from 'react'

import { THINKING_LEVELS } from '../../lib/chat-api.ts'
import type { ProviderLogin, ProviderModel } from '../../lib/provider-api.ts'
import { listProviderLogins, listProviderModels } from '../../lib/provider-api.ts'
import { updateSettings } from '../../lib/settings-api.ts'
import type { BackgroundModelEntry } from '../../lib/settings-api.ts'
import { Button } from '../ui/button.tsx'
import { Label } from '../ui/label.tsx'

const selectClass =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'The background model could not be saved.'

/** Global background choices, deliberately separate from every agent and conversation's run settings. */
export function BackgroundModelSettings({
  initialChain,
}: {
  readonly initialChain: readonly BackgroundModelEntry[]
}) {
  const [draft, setDraft] = useState<BackgroundModelEntry[]>([...initialChain])
  const [logins, setLogins] = useState<ProviderLogin[]>([])
  const [models, setModels] = useState<ProviderModel[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listProviderLogins(), listProviderModels()]).then(
      ([keys, catalog]) => {
        if (cancelled) return
        setLogins(keys)
        setModels(catalog)
        setLoaded(true)
      },
      (failure: unknown) => {
        if (!cancelled) setError(messageOf(failure))
      },
    )

    return () => {
      cancelled = true
    }
  }, [])

  const change = (index: number, patch: Partial<BackgroundModelEntry>): void => {
    setSaved(false)
    setDraft((current) => current.map((entry, position) => position === index ? { ...entry, ...patch } : entry))
  }

  const move = (index: number, offset: -1 | 1): void => {
    setSaved(false)
    setDraft((current) => {
      const destination = index + offset
      if (destination < 0 || destination >= current.length) return current
      const next = [...current]
      const entry = next[index]
      const displaced = next[destination]
      if (entry === undefined || displaced === undefined) return current
      next[index] = displaced
      next[destination] = entry

      return next
    })
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setSaved(false)
    setError(null)
    try {
      const updated = await updateSettings({ backgroundModel: draft })
      setDraft([...updated.backgroundModel])
      setSaved(true)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const add = (): void => {
    const credentialId = logins[0]?.id
    const modelId = models[0]?.id
    if (credentialId === undefined || modelId === undefined) return
    setSaved(false)
    setDraft((current) => [...current, { credentialId, modelId, thinkingLevel: 'off' }])
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-labelledby="background-model-heading">
      <div className="flex flex-col gap-1">
        <h2 id="background-model-heading" className="font-medium">Background model</h2>
        <p className="text-muted-foreground">
          Used for titles and other background jobs; the next entry is used only when the one before is out of usage.
        </p>
      </div>

      {draft.length === 0 ? <p className="text-muted-foreground">No background model configured.</p> : (
        <ol className="flex flex-col gap-3">
          {draft.map((entry, index) => {
            // Every key is an OpenCode Go key, so its catalog is the install's catalog; no key means no model choices.
            const availableModels = logins.some((login) => login.id === entry.credentialId) ? models : []
            const position = index + 1

            return (
              <li key={`${entry.credentialId}-${index}`} className="flex flex-col gap-3 rounded-md border p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`background-key-${index}`}>Key {position}</Label>
                    <select
                      id={`background-key-${index}`}
                      className={selectClass}
                      value={entry.credentialId}
                      onChange={(event) => change(index, {
                        credentialId: event.target.value,
                        modelId: models[0]?.id ?? '',
                      })}
                    >
                      {logins.some((login) => login.id === entry.credentialId) ? null : (
                        <option value={entry.credentialId}>Unavailable key</option>
                      )}
                      {logins.map((login) => <option key={login.id} value={login.id}>{login.label}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`background-model-${index}`}>Model {position}</Label>
                    <select
                      id={`background-model-${index}`}
                      className={selectClass}
                      value={entry.modelId}
                      onChange={(event) => change(index, { modelId: event.target.value })}
                    >
                      {availableModels.some((model) => model.id === entry.modelId) ? null : (
                        <option value={entry.modelId}>{entry.modelId || 'No models available'}</option>
                      )}
                      {availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`background-thinking-${index}`}>Thinking {position}</Label>
                    <select
                      id={`background-thinking-${index}`}
                      className={selectClass}
                      value={entry.thinkingLevel}
                      onChange={(event) => {
                        const thinkingLevel = THINKING_LEVELS.find((level) => level === event.target.value)
                        if (thinkingLevel !== undefined) change(index, { thinkingLevel })
                      }}
                    >
                      {THINKING_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="xs" variant="outline" disabled={index === 0} onClick={() => move(index, -1)}>
                    Move up
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={index === draft.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setSaved(false)
                      setDraft((current) => current.filter((_entry, position) => position !== index))
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {error === null ? null : <p role="alert" className="text-destructive">{error}</p>}
      {saved ? <output className="text-muted-foreground">Background model saved.</output> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!loaded || logins.length === 0 || models.length === 0}
          onClick={add}
        >
          Add entry
        </Button>
        <Button type="button" size="sm" aria-label="Save background model" disabled={busy || !loaded} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </section>
  )
}
