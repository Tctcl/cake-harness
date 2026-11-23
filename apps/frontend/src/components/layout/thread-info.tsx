import { PencilIcon } from 'lucide-react'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import type { ChatAgent, ChatThread, WorkspaceSummary } from '../../lib/chat-api.ts'
import { listAgents, renameThread } from '../../lib/chat-api.ts'
import type { ChatAgentGrants } from '../../lib/capability-api.ts'
import { getAgentGrants } from '../../lib/capability-api.ts'
import { snapshotOf, subscribeToThread } from '../../lib/chat-store.ts'
import { Input } from '../ui/input.tsx'
import { Separator } from '../ui/separator.tsx'

type ThreadInfoSidebarProps = {
  thread: ChatThread | null
  workspace: WorkspaceSummary | null
  onRenamed: (thread: ChatThread) => void
}

const count = (value: number) => value.toLocaleString('en-US')

const money = (value: number) => `$${value.toFixed(value < 0.01 && value > 0 ? 4 : 2)}`

/** A labelled line of the info panel; the value is allowed to wrap so a long model id stays readable. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
}

function Counts({ grants }: { grants: ChatAgentGrants | null }) {
  if (grants === null) return <span className="text-sm text-muted-foreground">—</span>

  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      <span>{grants.tools.length} tools</span>
      <span>{grants.mcpServers.length} MCP</span>
      <span>{grants.skills.length} skills</span>
    </span>
  )
}

/**
 * Everything about the open conversation: its name, the agent answering it with the capabilities the agent actually
 * carries, the model and spend of the run. The transcript column stays free of this, which is why the header it used to
 * have is gone.
 */
export function ThreadInfoSidebar({ thread, workspace, onRenamed }: ThreadInfoSidebarProps) {
  const threadId = thread?.id ?? null
  const subscribe = useCallback(
    (listener: () => void) => (threadId === null ? () => {} : subscribeToThread(threadId, listener)),
    [threadId],
  )
  const read = useCallback(() => snapshotOf(threadId), [threadId])
  const state = useSyncExternalStore(subscribe, read)

  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [grants, setGrants] = useState<ChatAgentGrants | null>(null)
  // The draft belongs to the conversation being renamed, so switching conversations closes the editor without an effect.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const workspaceId = thread?.workspaceId ?? null

  useEffect(() => {
    if (workspaceId === null) return

    let cancelled = false
    void listAgents(workspaceId).then(
      (loaded) => {
        if (!cancelled) setAgents(loaded)
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'agents failed to load')
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  // Grants are ids on the agent; the panel only counts them, so a failure leaves the line blank rather than an error.
  const agentId = thread?.agentId ?? null

  useEffect(() => {
    if (agentId === null) return

    let cancelled = false
    void getAgentGrants(agentId).then(
      (loaded) => {
        if (!cancelled) setGrants(loaded)
      },
      () => {
        if (!cancelled) setGrants(null)
      },
    )

    return () => {
      cancelled = true
    }
  }, [agentId])

  if (thread === null) {
    return <p className="px-2 text-xs text-muted-foreground">No conversation selected.</p>
  }

  const editing = editingId === thread.id
  const agent = agents.find((candidate) => candidate.id === thread.agentId) ?? null
  const title = thread.title ?? 'Untitled conversation'

  function save() {
    if (thread === null) return

    const next = draft.trim()
    setEditingId(null)
    void renameThread(thread.id, next === '' ? null : next).then(onRenamed, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : 'the title could not be saved')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
          >
            <Input
              aria-label="Conversation title"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={save}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setEditingId(null)
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            className="group flex items-start gap-1 text-left"
            aria-label="Rename conversation"
            onClick={() => {
              setDraft(thread.title ?? '')
              setEditingId(thread.id)
            }}
          >
            <span className="text-sm font-medium break-words">{title}</span>
            <PencilIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
          </button>
        )}
        <span className="text-xs text-muted-foreground">{workspace?.name ?? 'Workspace'}</span>
      </div>

      <Separator />

      <dl className="flex flex-col gap-3">
        <Field label="Agent">{agent?.name ?? 'Unknown agent'}</Field>
        {agent === null || agent.description === '' ? null : (
          <p className="text-xs text-muted-foreground">{agent.description}</p>
        )}
        {agent === null ? null : (
          <>
            <Field label="Access">{agent.allowAll ? 'Everything the workspace allows' : 'A selection within the workspace'}</Field>
            <Field label="Granted">
              <Counts grants={grants} />
            </Field>
          </>
        )}

        <Separator />

        <Field label="Model">{state.run?.model ?? 'Not run yet'}</Field>
        <Field label="Provider">{state.run?.provider ?? '—'}</Field>
        <Field label="Thinking">{state.run?.thinkingLevel ?? 'Off'}</Field>

        <Separator />

        <Field label="Context">{count(state.usage.total)} tokens</Field>
        <Field label="Input / output">
          {count(state.usage.input)} / {count(state.usage.output)}
        </Field>
        <Field label="Cache read / write">
          {count(state.usage.cacheRead)} / {count(state.usage.cacheWrite)}
        </Field>
        <Field label="Cost">{money(state.usage.cost)}</Field>
      </dl>

      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export { Field as ThreadInfoField }
