import { useEffect, useState } from 'react'

import type { ProviderLogin, ProviderModel, WorkspaceProviders as WorkspaceProvidersState } from '../../lib/provider-api.ts'
import {
  createProviderLogin,
  getWorkspaceProviders,
  listProviderLogins,
  listProviderModels,
  setWorkspaceProviders,
} from '../../lib/provider-api.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Separator } from '../ui/separator.tsx'
import { Spinner } from '../ui/spinner.tsx'

const money = (value: number | null): string => (value === null ? '—' : `$${value.toFixed(2)}`)

const tokens = (value: number | null): string =>
  value === null ? '—' : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)

/**
 * Which models a workspace reaches. A login belongs to the user, so this tab links the ones the workspace may use and then
 * allows or disallows individual models behind them; two keys on one provider are one provider row with a count, because
 * the provider is what the models hang off.
 */
export function WorkspaceProviders({ workspaceId }: { workspaceId: string }) {
  const [logins, setLogins] = useState<ProviderLogin[] | null>(null)
  const [models, setModels] = useState<ProviderModel[] | null>(null)
  const [draft, setDraft] = useState<WorkspaceProvidersState | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([listProviderLogins(), listProviderModels(), getWorkspaceProviders(workspaceId)]).then(
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
  }, [workspaceId, nonce])

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

  const linked = logins.filter((login) => draft.loginIds.includes(login.id))
  const available = logins.filter((login) => !draft.loginIds.includes(login.id))
  // One row per provider: the logins behind it are counted, not listed.
  const providers = [...new Set(linked.map((login) => login.provider))]
  const active = provider !== null && providers.includes(provider) ? provider : (providers[0] ?? null)
  const shownModels = active === null ? [] : models.filter((model) => model.provider === active)

  const patch = (next: Partial<WorkspaceProvidersState>): void =>
    setDraft((current) => (current === null ? current : { ...current, ...next }))

  const toggleModel = (id: string): void =>
    patch({
      allowedModels: draft.allowedModels.includes(id)
        ? draft.allowedModels.filter((entry) => entry !== id)
        : [...draft.allowedModels, id],
    })

  async function save(): Promise<void> {
    if (draft === null) return

    setBusy(true)
    try {
      setDraft(await setWorkspaceProviders(workspaceId, draft))
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the providers could not be saved')
    } finally {
      setBusy(false)
    }
  }

  async function create(input: { provider: string; label: string; key: string }): Promise<void> {
    if (draft === null) return

    setBusy(true)
    try {
      const login = await createProviderLogin(input)
      setDraft({ ...draft, loginIds: [...draft.loginIds, login.id] })
      setNonce((value) => value + 1)
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the login could not be created')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4 text-sm">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground">
          A login is yours, stored once; this workspace links the ones it may use. Every model behind a linked login can be
          allowed or disallowed, and a disallowed model cannot be picked for a conversation here.
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setAdding((open) => !open)}>
          Add provider login
        </Button>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-0 gap-4">
        <ul aria-label="Providers" className="flex w-56 shrink-0 flex-col gap-1">
          {providers.length === 0 ? (
            <li className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              No provider is linked yet, so this workspace cannot reach a model.
            </li>
          ) : null}
          {providers.map((name) => {
            const count = linked.filter((login) => login.provider === name).length

            return (
              <li key={name}>
                <button
                  type="button"
                  aria-current={name === active ? 'true' : undefined}
                  onClick={() => setProvider(name)}
                  className={`flex w-full items-center gap-2 rounded-md border p-2 text-left ${
                    name === active ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                  {count > 1 ? (
                    <Badge
                      variant="secondary"
                      className="shrink-0 text-[10px] font-normal"
                      title={linked
                        .filter((login) => login.provider === name)
                        .map((login) => login.label)
                        .join(', ')}
                    >
                      {count} logins
                    </Badge>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>

        <div className="min-w-0 flex-1">
          {active === null ? (
            <p className="text-muted-foreground">Link a login to choose its models.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{active}</span>
                <label htmlFor="providers-allow-all" className="ml-auto flex items-center gap-2 text-xs">
                  <input
                    id="providers-allow-all"
                    type="checkbox"
                    className="size-4 accent-foreground"
                    checked={draft.allowAllModels}
                    onChange={(event) => patch({ allowAllModels: event.target.checked })}
                  />
                  Allow every model from these logins
                </label>
              </div>
              <ul className="flex flex-col gap-1">
                {shownModels.map((model) => (
                  <li key={model.id} className="flex items-start gap-3 rounded-md border p-3">
                    <input
                      type="checkbox"
                      id={`model-${model.id}`}
                      className="mt-0.5 size-4 shrink-0 accent-foreground"
                      checked={draft.allowAllModels || draft.allowedModels.includes(model.id)}
                      disabled={draft.allowAllModels}
                      onChange={() => toggleModel(model.id)}
                    />
                    <div className="flex min-w-0 flex-col gap-1">
                      <label htmlFor={`model-${model.id}`} className="font-medium">
                        {model.name}
                      </label>
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>context {tokens(model.contextWindow)}</span>
                        <span>max out {tokens(model.maxOutput)}</span>
                        <span>
                          in {money(model.inputUsdPerMillion)} / out {money(model.outputUsdPerMillion)} per M
                        </span>
                        {model.supportsReasoning ? <span>reasoning</span> : null}
                        {model.supportsTools ? <span>tools</span> : null}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {shownModels.length === 0 ? (
                <p className="text-muted-foreground">This provider reported no models.</p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <Button size="sm" className="w-fit" disabled={busy} onClick={() => void save()}>
        Save
      </Button>

      {adding ? (
        <>
          <Separator />
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <span className="font-medium">Your logins</span>
            {available.length === 0 ? (
              <span className="text-xs text-muted-foreground">Every login you have is already linked here.</span>
            ) : (
              <ul className="flex flex-col gap-1">
                {available.map((login) => (
                  <li key={login.id} className="flex items-center gap-2 rounded-md border p-2">
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{login.provider}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{login.label}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => patch({ loginIds: [...draft.loginIds, login.id] })}
                    >
                      Link
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <Separator />
            <NewLogin busy={busy} onCreate={(input) => void create(input)} />
            <span className="text-xs text-muted-foreground">
              A new login is stored once for your user, then linked here. It is not saved as this workspace&rsquo;s until
              you press Save.
            </span>
          </div>
        </>
      ) : null}
    </div>
  )
}

/** A provider key, entered once. The label is what tells two keys on the same provider apart in the list. */
function NewLogin({
  busy,
  onCreate,
}: {
  busy: boolean
  onCreate: (input: { provider: string; label: string; key: string }) => void
}) {
  const [provider, setProvider] = useState('')
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')

  const ready = provider.trim() !== '' && label.trim() !== '' && key.trim() !== ''

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        onCreate({ provider: provider.trim(), label: label.trim(), key: key.trim() })
        setProvider('')
        setLabel('')
        setKey('')
      }}
    >
      <span className="font-medium">New global login</span>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Provider"
          placeholder="anthropic"
          className="w-40"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        />
        <Input
          aria-label="Label"
          placeholder="personal"
          className="w-40"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Input
          aria-label="Key"
          type="password"
          placeholder="sk-…"
          className="min-w-40 flex-1"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || !ready}>
          Create and link
        </Button>
      </div>
    </form>
  )
}
