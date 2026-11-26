import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import type { Session } from '../../lib/auth-api.ts'
import {
  changePassword,
  disableSecondFactor,
  enableSecondFactor,
  listAccounts,
  readGitIdentity,
  readSession,
  saveGitIdentity,
  startSecondFactor,
} from '../../lib/auth-api.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Label } from '../ui/label.tsx'
import { Spinner } from '../ui/spinner.tsx'

const messageOf = (failure: unknown, fallback: string): string => (failure instanceof Error ? failure.message : fallback)

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-label={title}>
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  )
}

/** Runs one call for a form: `busy` while it is in flight, the backend's message or a confirmation afterwards. */
const useAction = () => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const run = (call: () => Promise<void>, confirmation: string): void => {
    setBusy(true)
    setError(null)
    setDone(null)
    call().then(
      () => {
        setBusy(false)
        setDone(confirmation)
      },
      (failure: unknown) => {
        setBusy(false)
        setError(messageOf(failure, 'that did not work'))
      },
    )
  }

  const status = (
    <>
      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {done === null ? null : <p className="text-muted-foreground">{done}</p>}
    </>
  )

  return { busy, run, status }
}

/**
 * The signed-in account: who it is, its password and its second factor. A single-user install has no account to
 * manage, so this says that and how sign-in gets turned on instead of drawing forms that could not work.
 */
export function AccountSection() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    readSession().then(setSession, (failure: unknown) => setError(messageOf(failure, 'the account failed to load')))
  }, [])

  if (session === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {error === null ? <Spinner /> : <span role="alert">{error}</span>}
      </p>
    )
  }

  if (session === null || session.singleUser) {
    return (
      <div className="flex max-w-prose flex-col gap-4 text-sm">
        <Card title="Single-user mode">
          <p className="text-muted-foreground">
            This install has no sign-in: everyone who can reach it acts as its owner. The installer turns sign-in on and
            creates the first admin; see the Install page of the manual.
          </p>
        </Card>
        <GitIdentityCard />
      </div>
    )
  }

  return (
    <div className="flex max-w-prose flex-col gap-4 text-sm">
      <Card title="Signed in as">
        <p>
          <span className="font-medium">{session.name}</span>
          {session.username === null ? null : <span className="text-muted-foreground"> · {session.username}</span>}
        </p>
      </Card>
      <GitIdentityCard />
      <PasswordCard />
      <SecondFactorCard accountId={session.id} />
    </div>
  )
}

function GitIdentityCard() {
  const [identity, setIdentity] = useState<{ readonly name: string; readonly email: string } | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const { busy, run, status } = useAction()

  useEffect(() => {
    void readGitIdentity().then(setIdentity, (failure: unknown) => setLoadError(messageOf(failure, 'git identity failed to load')))
  }, [])

  return (
    <Card title="Git identity">
      <p className="text-muted-foreground">Written to ~/.gitconfig in every workspace container on its next start.</p>
      {identity === null ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          {loadError === null ? <Spinner /> : <span role="alert">{loadError}</span>}
        </p>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => {
          event.preventDefault()
          run(async () => setIdentity(await saveGitIdentity(identity)), 'Git identity saved. Restart a container to apply it.')
        }}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="git-name">Name</Label>
            <Input id="git-name" autoComplete="name" value={identity.name} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="git-email">Email</Label>
            <Input id="git-email" type="email" autoComplete="email" value={identity.email} onChange={(event) => setIdentity({ ...identity, email: event.target.value })} />
          </div>
          {status}
          <Button type="submit" size="sm" className="w-fit" disabled={busy || ((identity.name.trim() === '') !== (identity.email.trim() === ''))}>
            Save git identity
          </Button>
        </form>
      )}
    </Card>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const { busy, run, status } = useAction()
  const mismatch = repeat !== '' && repeat !== next

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (mismatch) return
    run(async () => {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setRepeat('')
    }, 'Password changed. Other devices were signed out.')
  }

  return (
    <Card title="Password">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password-current">Current password</Label>
          <Input
            id="password-current"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password-next">New password</Label>
          <Input
            id="password-next"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          <span className="text-xs text-muted-foreground">At least 12 characters.</span>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password-repeat">Repeat new password</Label>
          <Input
            id="password-repeat"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={mismatch}
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
          {mismatch ? <span className="text-xs text-destructive">The two do not match.</span> : null}
        </div>
        {status}
        <Button type="submit" size="sm" className="w-fit" disabled={busy || mismatch}>
          Change password
        </Button>
      </form>
    </Card>
  )
}

/** Enrol or remove a TOTP authenticator. The state is read from the user list, which only an admin may read. */
function SecondFactorCard({ accountId }: { accountId: string }) {
  const [enabled, setEnabled] = useState<boolean | null | undefined>(undefined)
  const [setup, setSetup] = useState<{ readonly secret: string; readonly uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const { busy, run, status } = useAction()

  useEffect(() => {
    listAccounts().then(
      (rows) => setEnabled(rows === null ? null : (rows.find((row) => row.id === accountId)?.totp ?? null)),
      () => setEnabled(null),
    )
  }, [accountId])

  if (enabled === undefined || enabled === null) return null

  if (enabled) {
    return (
      <Card title="Two-factor sign-in">
        <p className="text-muted-foreground">On. Signing in asks for a code from your authenticator app.</p>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            run(async () => {
              await disableSecondFactor(password)
              setEnabled(false)
            }, 'Two-factor sign-in is off. Every session was signed out.')
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="totp-disable-password">Password</Label>
            <Input
              id="totp-disable-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {status}
          <Button type="submit" size="sm" variant="outline" className="w-fit" disabled={busy}>
            Turn off
          </Button>
        </form>
      </Card>
    )
  }

  return (
    <Card title="Two-factor sign-in">
      <p className="text-muted-foreground">
        Off. With it on, signing in also asks for a six-digit code from an authenticator app.
      </p>
      {setup === null ? (
        <>
          {status}
          <Button
            size="sm"
            className="w-fit"
            disabled={busy}
            onClick={() => run(async () => setSetup(await startSecondFactor()), '')}
          >
            Set up
          </Button>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            run(async () => {
              await enableSecondFactor(code)
              setEnabled(true)
              setSetup(null)
            }, 'Two-factor sign-in is on.')
          }}
        >
          <p>
            Add this secret to your authenticator app (as a time-based key), or open the link on the device that has the
            app:
          </p>
          <code className="w-fit rounded-sm bg-muted px-2 py-1 font-mono text-xs break-all">{setup.secret}</code>
          <a className="w-fit text-xs underline" href={setup.uri}>
            Open in authenticator
          </a>
          <div className="flex flex-col gap-2">
            <Label htmlFor="totp-code">Code from the app</Label>
            <Input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {status}
          <Button type="submit" size="sm" className="w-fit" disabled={busy}>
            Turn on
          </Button>
        </form>
      )}
    </Card>
  )
}
