import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import type { ChatAgent, ChatThread, WorkspaceSummary } from '../../lib/chat-api.ts'
import { listAgents } from '../../lib/chat-api.ts'
import type { ChatAgentGrants } from '../../lib/capability-api.ts'
import { getAgentGrants } from '../../lib/capability-api.ts'
import { snapshotOf, subscribeToThread } from '../../lib/chat-store.ts'
import type { DevEnvironment } from '../../lib/environment-api.ts'
import { getAgentEnvironment } from '../../lib/environment-api.ts'
import { AgentEnvironment } from './agent-environment.tsx'
import { EnvironmentCard } from './environment-card.tsx'
import { InfoSection, SectionRule } from './info-section.tsx'
import { SshCard } from './ssh-card.tsx'

type ThreadInfoSidebarProps = {
  thread: ChatThread | null
  workspace: WorkspaceSummary | null
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
 * Everything about the open conversation's surroundings: the workspace, the agent answering it with the capabilities
 * the agent actually carries, the container it works in, the model and spend of the run. The conversation's own name
 * lives in the topbar, so closing this panel never hides what is open.
 */
export function ThreadInfoSidebar({ thread, workspace }: ThreadInfoSidebarProps) {
  const threadId = thread?.id ?? null
  const subscribe = useCallback(
    (listener: () => void) => (threadId === null ? () => {} : subscribeToThread(threadId, listener)),
    [threadId],
  )
  const read = useCallback(() => snapshotOf(threadId), [threadId])
  const state = useSyncExternalStore(subscribe, read)

  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [grants, setGrants] = useState<ChatAgentGrants | null>(null)
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

  // The container the conversation runs in: the same one the picker offers, so the card below acts on that row.
  const [environment, setEnvironment] = useState<DevEnvironment | null>(null)

  useEffect(() => {
    if (workspaceId === null || agentId === null) return

    let cancelled = false
    void getAgentEnvironment(workspaceId, agentId).then(
      (loaded) => {
        // The endpoint answers `null` for "no container"; a body without the key is the same state, not a missing one.
        if (!cancelled) setEnvironment(loaded ?? null)
      },
      () => {
        if (!cancelled) setEnvironment(null)
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspaceId, agentId])

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

  const agent = agents.find((candidate) => candidate.id === thread.agentId) ?? null

  return (
    <div className="flex flex-col gap-3">
      <InfoSection title="Conversation">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium break-words">{workspace?.name ?? 'Workspace'}</span>
          <span className="text-xs text-muted-foreground">Workspace</span>
        </div>

        <dl className="flex flex-col gap-3">
          <Field label="Agent">{agent?.name ?? 'Unknown agent'}</Field>
          {agent === null || agent.description === '' ? null : (
            <p className="text-xs text-muted-foreground">{agent.description}</p>
          )}
          {agent === null ? null : (
            <>
              <Field label="Access">
                {agent.allowAll ? 'Everything the workspace allows' : 'A selection within the workspace'}
              </Field>
              <Field label="Granted">
                <Counts grants={grants} />
              </Field>
            </>
          )}
          <Field label="Model">{state.run?.model ?? 'Not run yet'}</Field>
          <Field label="Provider">{state.run?.provider ?? '—'}</Field>
          <Field label="Thinking">{state.run?.thinkingLevel ?? 'Off'}</Field>
        </dl>
      </InfoSection>

      <SectionRule />

      <InfoSection title="Environment">
        <AgentEnvironment workspaceId={thread.workspaceId} agentId={thread.agentId} />
        {environment === null ? (
          <p className="text-xs text-muted-foreground">This conversation runs in no container.</p>
        ) : (
          <EnvironmentCard environment={environment} onChanged={setEnvironment} />
        )}
      </InfoSection>

      <SectionRule />

      <InfoSection title="Context">
        <dl className="flex flex-col gap-3">
          <Field label="Context">{count(state.usage.total)} tokens</Field>
          <Field label="Input / output">
            {count(state.usage.input)} / {count(state.usage.output)}
          </Field>
          <Field label="Cache read / write">
            {count(state.usage.cacheRead)} / {count(state.usage.cacheWrite)}
          </Field>
          <Field label="Cost">{money(state.usage.cost)}</Field>
        </dl>
      </InfoSection>

      {environment === null ? null : (
        <>
          <SectionRule />
          <InfoSection title="SSH">
            <SshCard environmentId={environment.id} />
          </InfoSection>
        </>
      )}

      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export { Field as ThreadInfoField }
