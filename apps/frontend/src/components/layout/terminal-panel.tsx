import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { PlusIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'

import { getWorkspaceEnvironment } from '../../lib/environment-api.ts'
import type { TerminalAttachment, TerminalPayload } from '../../lib/terminal-api.ts'
import {
  attachTerminal,
  CLOSE_UNKNOWN_TERMINAL,
  createTerminal,
  deleteTerminal,
  listTerminals,
} from '../../lib/terminal-api.ts'
import { Button } from '../ui/button.tsx'

const message = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure))

/** The palette the emulator paints with: xterm draws on a canvas, so the CSS variables are read once at mount. */
function palette() {
  const styles = getComputedStyle(document.documentElement)

  return {
    background: styles.getPropertyValue('--background').trim() || '#191919',
    foreground: styles.getPropertyValue('--foreground').trim() || '#efefef',
  }
}

type TerminalViewProps = {
  workspaceId: string
  environmentId: string
  terminal: TerminalPayload
  active: boolean
  /** The backend no longer has this session: it was closed elsewhere, or the process restarted. */
  onGone: (terminalId: string) => void
}

/**
 * One session: an emulator and the socket feeding it, both kept alive while the tab is hidden so output arriving in the
 * background is not lost. The server is told the size on every fit and on being shown again, because a hidden panel
 * measures 0×0 and the backend would otherwise keep the size it had before.
 */
function TerminalView({ workspaceId, environmentId, terminal, active, onGone }: TerminalViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const emulator = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const attachment = useRef<TerminalAttachment | null>(null)
  const gone = useRef(onGone)

  useEffect(() => {
    gone.current = onGone
  }, [onGone])

  /** Reports the size the emulator has now; a 0×0 emulator is not worth a frame the server would clamp to 1×1. */
  const report = useCallback(() => {
    const view = emulator.current
    const link = attachment.current
    if (view === null || link === null) return
    if (view.cols < 2 || view.rows < 2) return

    link.resize({ cols: view.cols, rows: view.rows })
  }, [])

  useEffect(() => {
    const element = host.current
    if (element === null) return

    const view = new Terminal({
      fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: palette(),
    })
    const fitAddon = new FitAddon()
    view.loadAddon(fitAddon)
    view.open(element)
    emulator.current = view
    fit.current = fitAddon

    const link = attachTerminal(workspaceId, environmentId, terminal.id, {
      // Before the replay: a full-screen program addresses the cursor with the size the emulator reports here.
      onReady: (ready) => {
        view.resize(ready.size.cols, ready.size.rows)
        report()
      },
      onOutput: (bytes) => view.write(bytes),
      onExit: (exit) =>
        view.writeln(
          `\r\n\x1b[2m[the program exited with code ${exit.code ?? '—'}${
            exit.signal === null ? '' : ` (${exit.signal})`
          }]\x1b[0m`,
        ),
      onError: (failure) => view.writeln(`\r\n\x1b[2m[${failure.code}] ${failure.message}\x1b[0m`),
      onClosed: (event) => {
        if (event.code === CLOSE_UNKNOWN_TERMINAL) {
          gone.current(terminal.id)

          return
        }

        view.writeln(
          `\r\n\x1b[2m[the session detached${event.reason === '' ? '' : `: ${event.reason}`}]\x1b[0m`,
        )
      },
    })
    attachment.current = link

    const typed = view.onData((chunk) => link.write(chunk))

    const refit = () => {
      fitAddon.fit()
      report()
    }

    // jsdom has no ResizeObserver, and a test that renders the panel has no layout to fit anyway.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit)
    observer?.observe(element)
    window.addEventListener('resize', refit)

    return () => {
      window.removeEventListener('resize', refit)
      observer?.disconnect()
      typed.dispose()
      link.close()
      view.dispose()
      attachment.current = null
      emulator.current = null
      fit.current = null
    }
  }, [workspaceId, environmentId, terminal.id, report])

  // Coming back to a tab: the element has a size again, so the emulator and the server are brought up to date.
  useEffect(() => {
    if (!active) return

    fit.current?.fit()
    report()
  }, [active, report])

  return <div ref={host} className={active ? 'h-full w-full px-2 py-1' : 'hidden'} />
}

type TerminalPanelProps = {
  workspaceId: string
}

/**
 * Shell sessions in the workspace's one environment, including General's user-only container. Sessions belong to the
 * backend and outlive this panel, so opening it lists what already exists instead of starting from nothing, and a tab
 * is closed through the backend rather than by dropping a socket.
 */
export function TerminalPanel({ workspaceId }: TerminalPanelProps) {
  const [environmentId, setEnvironmentId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<TerminalPayload[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getWorkspaceEnvironment(workspaceId).then(
      (environment) => {
        if (!cancelled) setEnvironmentId(environment?.id ?? null)
      },
      (failure: unknown) => {
        if (!cancelled) setError(message(failure))
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useEffect(() => {
    if (environmentId === null) return

    let cancelled = false
    void listTerminals(workspaceId, environmentId).then(
      (loaded) => {
        if (cancelled) return
        setSessions(loaded)
        setActiveId((current) =>
          current !== null && loaded.some((session) => session.id === current)
            ? current
            : (loaded[0]?.id ?? null),
        )
      },
      (failure: unknown) => {
        if (!cancelled) setError(message(failure))
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId, environmentId])

  async function openSession() {
    if (environmentId === null) return

    setCreating(true)
    setError(null)
    try {
      const created = await createTerminal(workspaceId, environmentId)
      setSessions((current) => [...current, created])
      setActiveId(created.id)
    } catch (failure) {
      setError(message(failure))
    } finally {
      setCreating(false)
    }
  }

  async function closeSession(terminal: TerminalPayload) {
    if (environmentId === null) return

    try {
      await deleteTerminal(workspaceId, environmentId, terminal.id)
    } catch (failure) {
      setError(message(failure))

      return
    }

    const remaining = sessions.filter((session) => session.id !== terminal.id)
    setSessions(remaining)
    setActiveId((current) => (current === terminal.id ? (remaining[0]?.id ?? null) : current))
  }

  /** A session the backend no longer has is dropped from the list rather than left behind as a dead tab. */
  function forget(terminalId: string) {
    const remaining = sessions.filter((session) => session.id !== terminalId)
    setSessions(remaining)
    setActiveId((current) => (current === terminalId ? (remaining[0]?.id ?? null) : current))
    setError('that terminal is gone: the backend restarted, or the program exited')
  }

  if (environmentId === null) {
    return <Hint>This workspace has no environment attached.</Hint>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Terminal sessions"
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
      >
        {sessions.map((session) => (
          <span
            key={session.id}
            className={`flex items-center rounded-md ${
              session.id === activeId
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={session.id === activeId}
              className="max-w-40 truncate py-1 pl-2 text-xs"
              onClick={() => setActiveId(session.id)}
            >
              {session.label}
            </button>
            <button
              type="button"
              aria-label={`Close ${session.label}`}
              className="p-0.5 pr-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => void closeSession(session)}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          aria-label="New terminal session"
          disabled={creating}
          onClick={() => void openSession()}
        >
          <PlusIcon />
        </Button>
      </div>

      {error === null ? null : (
        <p role="alert" className="shrink-0 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1">
        {sessions.length === 0 ? (
          <Hint>No terminal session yet.</Hint>
        ) : (
          sessions.map((session) => (
            <TerminalView
              key={session.id}
              workspaceId={workspaceId}
              environmentId={environmentId}
              terminal={session}
              active={session.id === activeId}
              onGone={forget}
            />
          ))
        )}
      </div>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-xs text-muted-foreground">{children}</p>
}
