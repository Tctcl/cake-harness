import { Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { Credential, CredentialInput, CredentialKind } from '../../lib/credentials-api.ts'
import { createCredential, deleteCredential, listCredentials } from '../../lib/credentials-api.ts'
import { MasterDetail, NEW_SELECTION } from '../layout/master-detail.tsx'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Spinner } from '../ui/spinner.tsx'

const KINDS: readonly { readonly id: CredentialKind; readonly label: string; readonly description: string }[] = [
  {
    id: 'opencode-go',
    label: 'OpenCode Go API keys',
    description: 'Keys for the model provider, each naming the account it belongs to.',
  },
  {
    id: 'mcp',
    label: 'MCP auth keys',
    description: 'Keys for MCP servers. The server id decides which servers a key is offered to.',
  },
  {
    id: 'github-token',
    label: 'GitHub tokens',
    description: 'Tokens delivered to workspace containers for gh and Git HTTPS authentication.',
  },
]

interface Draft {
  readonly kind: CredentialKind
  readonly name: string
  readonly value: string
  readonly email: string
  readonly mcpId: string
  readonly note: string
  /** `yyyy-mm-dd`, as the date input gives it; empty means the key does not expire. */
  readonly expiresOn: string
}

const emptyDraft = (kind: CredentialKind): Draft => ({
  kind,
  name: '',
  value: '',
  email: '',
  mcpId: '',
  note: '',
  expiresOn: '',
})

const kindLabel = (kind: CredentialKind): string => KINDS.find((entry) => entry.id === kind)?.label ?? kind

/** A key that expires on a day works through that day, so the date is stored as the end of it, in UTC. */
const expiresAtOf = (expiresOn: string): string | null =>
  expiresOn === '' ? null : new Date(`${expiresOn}T23:59:59.999Z`).toISOString()

const expiryLabel = (credential: Credential): string =>
  credential.expiresAt === null
    ? 'Never expires'
    : `Expires ${new Date(credential.expiresAt).toISOString().slice(0, 10)}`

const toInput = (draft: Draft): CredentialInput => {
  const base = {
    kind: draft.kind,
    name: draft.name.trim(),
    value: draft.value.trim(),
    expiresAt: expiresAtOf(draft.expiresOn),
  }

  if (draft.kind === 'opencode-go') return { ...base, email: draft.email.trim() }
  if (draft.kind === 'github-token') return base

  return { ...base, mcpId: draft.mcpId.trim(), note: draft.note.trim() === '' ? null : draft.note.trim() }
}

const isComplete = (draft: Draft): boolean => {
  if (draft.name.trim() === '' || draft.value.trim() === '') return false

  if (draft.kind === 'github-token') return true

  return draft.kind === 'opencode-go' ? draft.email.trim() !== '' : draft.mcpId.trim() !== ''
}

/** The facts about one credential that the page shows; the secret is never among them, because it is never sent. */
function CredentialRow({
  credential,
  busy,
  onDelete,
}: {
  credential: Credential
  busy: boolean
  onDelete: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {credential.name}
          {credential.mcpId === null ? null : (
            <Badge variant="secondary" className="font-mono text-[10px] font-normal">
              {credential.mcpId}
            </Badge>
          )}
        </span>
        {credential.email === null ? null : <span className="text-xs text-muted-foreground">{credential.email}</span>}
        {credential.note === null ? null : (
          <span className="text-xs break-words text-muted-foreground">{credential.note}</span>
        )}
        <span className="text-xs text-muted-foreground">{expiryLabel(credential)}</span>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="ml-auto shrink-0"
        aria-label={`Delete ${credential.name}`}
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2Icon className="size-4" aria-hidden />
      </Button>
    </div>
  )
}

function DraftForm({
  draft,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: Draft
  busy: boolean
  onChange: (next: Partial<Draft>) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <form
      className="flex flex-col gap-3 rounded-md border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <span className="font-medium">New credential</span>

      <div className="flex flex-col gap-1">
        <label htmlFor="credential-kind" className="font-medium">
          Type
        </label>
        <select
          id="credential-kind"
          className="h-9 w-fit rounded-md border bg-transparent px-2 text-sm"
          value={draft.kind}
          onChange={(event) => {
            const kind = event.target.value
            onChange({ kind: kind === 'mcp' || kind === 'github-token' ? kind : 'opencode-go' })
          }}
        >
          {KINDS.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {kind.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="credential-name" className="font-medium">
          Key name
        </label>
        <Input
          id="credential-name"
          placeholder={draft.kind === 'mcp' ? 'github-pat' : 'work-account'}
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </div>

      {draft.kind === 'opencode-go' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="credential-email" className="font-medium">
            Account email
          </label>
          <Input
            id="credential-email"
            type="email"
            placeholder="you@example.com"
            value={draft.email}
            onChange={(event) => onChange({ email: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">Which OpenCode Go account this key bills.</span>
        </div>
      ) : draft.kind === 'mcp' ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="credential-mcp" className="font-medium">
              MCP id
            </label>
            <Input
              id="credential-mcp"
              className="font-mono"
              placeholder="github"
              value={draft.mcpId}
              onChange={(event) => onChange({ mcpId: event.target.value })}
            />
            <span className="text-xs text-muted-foreground">
              The server id this key works for. Servers with the same id in the MCP tab are offered this key.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="credential-note" className="font-medium">
              Note
            </label>
            <Input
              id="credential-note"
              placeholder="Personal token, expires with the org"
              value={draft.note}
              onChange={(event) => onChange({ note: event.target.value })}
            />
          </div>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">The newest GitHub token is used by newly started containers.</span>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="credential-value" className="font-medium">
          Key
        </label>
        <Input
          id="credential-value"
          type="password"
          autoComplete="off"
          className="font-mono"
          value={draft.value}
          onChange={(event) => onChange({ value: event.target.value })}
        />
        <span className="text-xs text-muted-foreground">Stored once and never shown again.</span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="credential-expiry" className="font-medium">
          Expiration date
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="credential-expiry"
            type="date"
            className="w-fit"
            value={draft.expiresOn}
            onChange={(event) => onChange({ expiresOn: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">Leave empty for a key that does not expire.</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !isComplete(draft)}>
          Add credential
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * The keys this user owns, in two lists because the two kinds are not the same thing: a provider key names an account,
 * an MCP key names the server it answers for. Both are written here and never read back.
 */
export function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[] | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void listCredentials().then(
      (loaded) => {
        if (!cancelled) {
          setCredentials(loaded)
          setError(null)
        }
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'the credentials failed to load')
      },
    )

    return () => {
      cancelled = true
    }
  }, [nonce])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      setError(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the credential could not be saved')
    } finally {
      setBusy(false)
      setNonce((value) => value + 1)
    }
  }

  const submit = (): void => {
    if (draft === null || !isComplete(draft)) return

    void run(async () => {
      const saved = await createCredential(toInput(draft))
      setDraft(null)
      setSelection(saved.id)
    })
  }

  const select = (id: string | null): void => {
    setSelection(id)
    setDraft(id === NEW_SELECTION ? emptyDraft('opencode-go') : null)
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="max-w-3xl text-muted-foreground">
        Provider, MCP and GitHub keys are stored once and never shown again. Add a key on the right, or select one to see its
        metadata.
      </p>
      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {credentials === null ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Spinner /> Loading credentials…
        </p>
      ) : (
        <MasterDetail
          listLabel="Credentials"
          newLabel="New credential"
          items={credentials.map((credential) => ({
            id: credential.id,
            name: credential.name,
            detail: `${kindLabel(credential.kind)} · ${expiryLabel(credential)}`,
          }))}
          selection={selection}
          onSelect={select}
          emptyText="No credentials yet."
          renderDetail={(item) => {
            const credential = credentials.find((candidate) => candidate.id === item?.id)
            if (draft !== null) {
              return (
                <DraftForm
                  draft={draft}
                  busy={busy}
                  onChange={(next) => setDraft((current) => (current === null ? current : { ...current, ...next }))}
                  onSubmit={submit}
                  onCancel={() => select(null)}
                />
              )
            }
            return credential === undefined ? null : (
              <CredentialRow
                credential={credential}
                busy={busy}
                onDelete={() => {
                  setSelection(null)
                  void run(async () => await deleteCredential(credential.id))
                }}
              />
            )
          }}
        />
      )}
    </div>
  )
}
