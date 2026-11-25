import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import type { Session } from '../../lib/auth-api.ts'
import { readSession, setInitialPassword, signIn, signOut, verifySecondFactor } from '../../lib/auth-api.ts'
import { SIGNED_OUT_EVENT } from '../../lib/http.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Label } from '../ui/label.tsx'
import { Spinner } from '../ui/spinner.tsx'

type GateState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'session'; readonly session: Session }

const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback)

/**
 * Nothing below this renders until the backend has named who is asking. A single-user install answers with the owner
 * and passes straight through; an install with accounts shows the sign-in form, then whatever step the session still
 * owes (a password an admin chose, or a second factor), then the app.
 *
 * Any call that later answers `auth.unauthenticated` (an expired cookie, a sign-out in another tab) brings the form
 * back, so no screen has to handle a lost session on its own.
 */
export function AuthGate({ children }: { children: (signOut: (() => void) | undefined) => ReactNode }) {
  const [state, setState] = useState<GateState>({ kind: 'loading' })

  const load = useCallback(() => {
    readSession().then(
      (session) => setState(session === null ? { kind: 'signed-out' } : { kind: 'session', session }),
      (error: unknown) => setState({ kind: 'failed', message: messageOf(error, 'the backend did not answer') }),
    )
  }, [])

  useEffect(() => {
    load()
    const lost = () => setState({ kind: 'signed-out' })
    window.addEventListener(SIGNED_OUT_EVENT, lost)

    return () => window.removeEventListener(SIGNED_OUT_EVENT, lost)
  }, [load])

  const leave = useCallback(() => {
    // Signed out locally even when the call fails: the cookie may already be gone, and staying "in" would be a lie.
    void signOut().finally(() => setState({ kind: 'signed-out' }))
  }, [])

  if (state.kind === 'loading') {
    return (
      <Centered>
        <Spinner />
      </Centered>
    )
  }

  if (state.kind === 'failed') {
    return (
      <Centered>
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
        <Button variant="outline" onClick={load}>
          Try again
        </Button>
      </Centered>
    )
  }

  if (state.kind === 'signed-out') {
    return (
      <SignInForm
        onSignedIn={(session) => setState({ kind: 'session', session })}
      />
    )
  }

  const { session } = state
  if (session.pending === 'password') return <InitialPasswordForm onDone={load} onCancel={leave} />
  if (session.pending === 'totp') return <SecondFactorForm onDone={load} onCancel={leave} />
  if (session.pending === 'totp-setup') {
    return (
      <Centered>
        <p className="max-w-sm text-center text-sm">
          This install requires a second factor, and enrolling one is not available in the app yet. Ask an admin to turn
          the requirement off, or enrol through the API (<code>POST /auth/2fa/setup</code>).
        </p>
        <Button variant="outline" onClick={leave}>
          Sign out
        </Button>
      </Centered>
    )
  }

  return children(session.singleUser ? undefined : leave)
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-4 p-6">{children}</div>
}

/** One form shape for the three steps: a title, the fields, the error the backend gave, and one submit. */
function GateForm({
  title,
  error,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  children,
}: {
  title: string
  error: string | null
  busy: boolean
  submitLabel: string
  onSubmit: () => void
  onCancel?: () => void
  children: ReactNode
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Centered>
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-4" aria-label={title}>
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? <Spinner /> : null}
          {submitLabel}
        </Button>
        {onCancel === undefined ? null : (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Sign out
          </Button>
        )}
      </form>
    </Centered>
  )
}

/** Runs one call for a form: `busy` while it is in flight, the backend's message when it fails. */
const useSubmit = () => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (call: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    call().then(
      () => setBusy(false),
      (failure: unknown) => {
        setBusy(false)
        setError(messageOf(failure, 'that did not work'))
      },
    )
  }

  return { busy, error, run }
}

function SignInForm({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, run } = useSubmit()

  return (
    <GateForm
      title="Sign in"
      error={error}
      busy={busy}
      submitLabel="Sign in"
      onSubmit={() => run(async () => onSignedIn(await signIn(username, password)))}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-in-username">Username</Label>
        <Input
          id="sign-in-username"
          autoComplete="username"
          required
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-in-password">Password</Label>
        <Input
          id="sign-in-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
    </GateForm>
  )
}

function SecondFactorForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('')
  const { busy, error, run } = useSubmit()

  return (
    <GateForm
      title="Second factor"
      error={error}
      busy={busy}
      submitLabel="Verify"
      onCancel={onCancel}
      onSubmit={() =>
        run(async () => {
          await verifySecondFactor(code)
          onDone()
        })
      }
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="second-factor-code">Code from your authenticator</Label>
        <Input
          id="second-factor-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
    </GateForm>
  )
}

function InitialPasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useSubmit()

  return (
    <GateForm
      title="Choose your password"
      error={error}
      busy={busy}
      submitLabel="Save password"
      onCancel={onCancel}
      onSubmit={() =>
        run(async () => {
          await setInitialPassword(password)
          onDone()
        })
      }
    >
      <p className="text-sm text-muted-foreground">
        An admin set your current password. Replace it before you continue.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="initial-password">New password</Label>
        <Input
          id="initial-password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
    </GateForm>
  )
}
