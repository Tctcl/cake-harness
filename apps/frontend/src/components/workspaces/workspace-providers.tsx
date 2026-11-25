import { useEffect, useState } from 'react'

import type { WorkspaceSummary } from '../../lib/chat-api.ts'
import type { ProviderLogin, ProviderModel, WorkspaceProviders as WorkspaceProvidersState } from '../../lib/provider-api.ts'
import {
  getWorkspaceProviders,
  listProviderLogins,
  listProviderModels,
  setWorkspaceProviders,
} from '../../lib/provider-api.ts'
import { Button } from '../ui/button.tsx'
import { Spinner } from '../ui/spinner.tsx'

const money = (value: number | null): string => (value === null ? '—' : `$${value.toFixed(2)}`)

const tokens = (value: number | null): string =>
  value === null ? '—' : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)

/**
 * Which of the user's keys a workspace may spend, and which models its agents may pick. Keys are added once, in
 * Settings → Credentials; this tab only links them. A workspace that reaches everything uses every key and model
 * without linking, so the tab says so rather than drawing choices that change nothing.
 */
export function WorkspaceProviders({
  workspace,
  onOpenCredentials,
}: {
  workspace: WorkspaceSummary
  onOpenCredentials: () => void
}) {
  const [logins, setLogins] = useState<ProviderLogin[] | null>(null)
  const [models, setModels] = useState<ProviderModel[] | null>(null)
  const [draft, setDraft] = useState<WorkspaceProvidersState | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listProviderLogins(), listProviderModels(), getWorkspaceProviders(workspace.id)]).then(
      ([loadedLogins, loadedModels, state]) => {
        if (cancelled) return
        setLogins(loadedLogins)
        setModels(loadedModels)
        setDraft(state)
        setError(null)
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'the providers failed to load')
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspace.id])

  if (logins === null || models === null || draft === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {error === null ? (
          <>
            <Spinner /> Loading providers…
          </>
        ) : (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        )}
      </p>
    )
  }

  if (logins.length === 0) {
    return (
      <div className="flex max-w-2xl flex-col items-start gap-3 rounded-md border border-dashed p-4 text-sm">
        <p className="font-medium">No OpenCode Go key yet</p>
        <p className="text-muted-foreground">
          Agents need a key to answer. Add one in Settings → Credentials; it is checked against OpenCode and its models are
          loaded. Then come back here to link it to this workspace.
        </p>
        <Button size="sm" onClick={onOpenCredentials}>
          Add a key
        </Button>
      </div>
    )
  }

  const change = (next: Partial<WorkspaceProvidersState>): void => {
    setSaved(false)
    setDraft((current) => (current === null ? current : { ...current, ...next }))
  }

  const toggle = (list: readonly string[], id: string): string[] =>
    list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]

  async function save(): Promise<void> {
    if (draft === null) return

    setBusy(true)
    try {
      setDraft(await setWorkspaceProviders(workspace.id, draft))
      setSaved(true)
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the providers could not be saved')
    } finally {
      setBusy(false)
    }
  }

  const everything = workspace.allowAll

  return (
    <div className="flex max-w-3xl flex-col gap-6 text-sm">
      {everything ? (
        <p className="rounded-md border bg-muted/40 p-3 text-muted-foreground">
          This workspace reaches everything, so its agents can use any of your keys and any model without linking. Turn
          that off on the Overview tab to narrow it here.
        </p>
      ) : null}

      <section aria-labelledby="providers-keys" className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 id="providers-keys" className="font-medium">
            Keys
          </h2>
          <Button size="sm" variant="ghost" onClick={onOpenCredentials}>
            Manage keys
          </Button>
        </div>
        <p className="text-muted-foreground">
          The keys this workspace may spend. An agent picks one of them; one left on “workspace default” uses the newest
          linked key.
        </p>
        <ul className="flex flex-col gap-1">
          {logins.map((login) => (
            <li key={login.id}>
              <label className="flex items-center gap-3 rounded-md border p-3">
                <input
                  type="checkbox"
                  aria-label={`Use ${login.label} in this workspace`}
                  className="size-4 shrink-0 accent-foreground"
                  disabled={everything}
                  checked={everything || draft.loginIds.includes(login.id)}
                  onChange={() => change({ loginIds: toggle(draft.loginIds, login.id) })}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{login.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">OpenCode Go</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="providers-models" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="providers-models" className="font-medium">
            Models
          </h2>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              aria-label="Allow every model"
              className="size-4 accent-foreground"
              disabled={everything}
              checked={everything || draft.allowAllModels}
              onChange={(event) => change({ allowAllModels: event.target.checked })}
            />
            Allow every model
          </label>
        </div>
        {models.length === 0 ? (
          <p className="text-muted-foreground">OpenCode reported no models for your keys.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {models.map((model) => {
              const allowed = everything || draft.allowAllModels || draft.allowedModels.includes(model.id)

              return (
                <li key={model.id}>
                  <label className="flex items-start gap-3 rounded-md border p-3" aria-label={`Allow ${model.name}`}>
                    <input
                      type="checkbox"
                      aria-label={`Allow ${model.name}`}
                      className="mt-0.5 size-4 shrink-0 accent-foreground"
                      checked={allowed}
                      disabled={everything || draft.allowAllModels}
                      onChange={() => change({ allowedModels: toggle(draft.allowedModels, model.id) })}
                    />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="font-medium">{model.name}</span>
                      <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="font-mono">{model.id}</span>
                        <span>context {tokens(model.contextWindow)}</span>
                        <span>
                          {money(model.inputUsdPerMillion)} in / {money(model.outputUsdPerMillion)} out per M
                        </span>
                        {model.supportsReasoning ? <span>reasoning</span> : null}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      {everything ? null : (
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
          {saved ? <span className="text-xs text-muted-foreground">Saved.</span> : null}
        </div>
      )}
    </div>
  )
}
