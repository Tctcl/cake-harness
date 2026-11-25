import { Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { GeneratedSshKey, SshKey } from '../../lib/ssh-keys-api.ts'
import { deleteSshKey, generateSshKey, listSshKeys, uploadSshKey } from '../../lib/ssh-keys-api.ts'
import { MasterDetail } from '../layout/master-detail.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Spinner } from '../ui/spinner.tsx'

function KeyDetail({
  sshKey,
  generated,
  busy,
  onDelete,
}: {
  sshKey: SshKey
  generated: GeneratedSshKey | null
  busy: boolean
  onDelete: () => void
}) {
  const generatedForKey = generated !== null && generated.key.id === sshKey.id ? generated : null

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">{sshKey.name}</h2>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{sshKey.fingerprint}</p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Delete ${sshKey.name}`}
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2Icon className="size-4" aria-hidden />
        </Button>
      </div>
      {generatedForKey === null ? null : (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="font-medium">Your private key is shown once</p>
          <p className="text-xs text-muted-foreground">Cake does not keep this; store it in ~/.ssh.</p>
          <textarea
            aria-label="Generated private key"
            className="min-h-48 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs"
            readOnly
            value={generatedForKey.privateKey}
          />
          <a
            className="w-fit rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            href={`data:application/octet-stream;charset=utf-8,${encodeURIComponent(generatedForKey.privateKey)}`}
            download={generatedForKey.filename}
          >
            Download {generatedForKey.filename}
          </a>
        </div>
      )}
    </div>
  )
}

export function SshKeysPage() {
  const [keys, setKeys] = useState<SshKey[] | null>(null)
  const [selection, setSelection] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [generated, setGenerated] = useState<GeneratedSshKey | null>(null)
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState<'upload' | 'generate' | 'delete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void listSshKeys().then(
      (loaded) => {
        if (active) {
          setKeys(loaded)
          setError(null)
        }
      },
      (failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : 'SSH keys could not be loaded')
      },
    )

    return () => {
      active = false
    }
  }, [nonce])

  const select = (id: string | null): void => {
    setSelection(id)
    setGenerated(null)
  }

  const complete = async (operation: 'upload' | 'generate' | 'delete', action: () => Promise<void>): Promise<void> => {
    setBusy(operation)
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'the SSH key could not be saved')
    } finally {
      setBusy(null)
      setNonce((value) => value + 1)
    }
  }

  const upload = (): void => {
    if (name.trim() === '' || publicKey.trim() === '') return
    void complete('upload', async () => {
      const saved = await uploadSshKey(name.trim(), publicKey.trim())
      setName('')
      setPublicKey('')
      setKeys((current) => current === null ? [saved] : [...current.filter((key) => key.id !== saved.id), saved])
      setSelection(saved.id)
    })
  }

  const generate = (): void => {
    if (name.trim() === '') return
    void complete('generate', async () => {
      const result = await generateSshKey(name.trim())
      setName('')
      setGenerated(result)
      setKeys((current) => current === null ? [result.key] : [...current.filter((key) => key.id !== result.key.id), result.key])
      setSelection(result.key.id)
    })
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="max-w-3xl text-muted-foreground">
        Add a public key or generate one for Remote-SSH. Private keys are never stored by Cake.
      </p>
      {error === null ? null : <p role="alert" className="text-destructive">{error}</p>}
      {keys === null ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Spinner /> Loading SSH keys…</p>
      ) : (
        <MasterDetail
          listLabel="SSH keys"
          newLabel="New SSH key"
          items={keys.map((key) => ({
            id: key.id,
            name: key.name,
            detail: key.fingerprint,
          }))}
          selection={selection}
          onSelect={select}
          emptyText="No SSH keys yet."
          renderDetail={(item) => {
            if (item === undefined) {
              return (
                <div className="flex flex-col gap-3 rounded-md border p-4">
                  <h2 className="font-medium">Add an SSH key</h2>
                  <label htmlFor="ssh-key-name" className="font-medium">Key name</label>
                  <Input
                    id="ssh-key-name"
                    placeholder="My laptop"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <label htmlFor="ssh-public-key" className="font-medium">Public key</label>
                  <textarea
                    id="ssh-public-key"
                    className="min-h-24 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs"
                    placeholder="ssh-ed25519 AAAA…"
                    value={publicKey}
                    onChange={(event) => setPublicKey(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" disabled={busy !== null || !name.trim() || !publicKey.trim()} onClick={upload}>
                      {busy === 'upload' ? 'Adding…' : 'Add public key'}
                    </Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy !== null || !name.trim()} onClick={generate}>
                      {busy === 'generate' ? 'Generating…' : 'Generate a key'}
                    </Button>
                  </div>
                </div>
              )
            }

            const sshKey = keys.find((candidate) => candidate.id === item.id)
            if (sshKey === undefined) return null

            return (
              <KeyDetail
                sshKey={sshKey}
                generated={generated}
                busy={busy !== null}
                onDelete={() => {
                  setSelection(null)
                  void complete('delete', async () => await deleteSshKey(sshKey.id))
                }}
              />
            )
          }}
        />
      )}
    </div>
  )
}
