import { useEffect, useState } from 'react'

import type { AgentDraft } from '../../lib/agent-api.ts'
import { createAgent, deleteAgent, listWorkspaceAgents, setAgentArchived, updateAgent } from '../../lib/agent-api.ts'
import type { ChatAgent, WorkspaceSummary } from '../../lib/chat-api.ts'
import { DEFAULT_MODEL_ID, THINKING_LEVELS } from '../../lib/chat-api.ts'
import type { ProviderLogin, ProviderModel, WorkspaceProviders } from '../../lib/provider-api.ts'
import { getWorkspaceProviders, listProviderLogins, listProviderModels } from '../../lib/provider-api.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Label } from '../ui/label.tsx'
import { Spinner } from '../ui/spinner.tsx'
import { Textarea } from '../ui/textarea.tsx'

/** The keys and models this workspace offers its agents, read once per visit to the tab. */
interface Choices {
  readonly keys: readonly ProviderLogin[]
  readonly models: readonly ProviderModel[]
}

const choicesOf = (
  workspace: WorkspaceSummary,
  logins: readonly ProviderLogin[],
  models: readonly ProviderModel[],
  providers: WorkspaceProviders,
): Choices => ({
  keys: workspace.allowAll ? logins : logins.filter((login) => providers.loginIds.includes(login.id)),
  models:
    workspace.allowAll || providers.allowAllModels
      ? models
      : models.filter((model) => providers.allowedModels.includes(model.id)),
})

const emptyDraft: AgentDraft = {
  name: '',
  description: '',
  systemPrompt: '',
  instructions: '',
  credentialId: null,
  modelId: null,
  thinkingLevel: 'low',
}

const draftOf = (agent: ChatAgent): AgentDraft => ({
  name: agent.name,
  description: agent.description,
  systemPrompt: agent.systemPrompt,
  instructions: agent.instructions,
  credentialId: agent.credentialId,
  modelId: agent.modelId,
  thinkingLevel: agent.thinkingLevel,
})

const messageOf = (failure: unknown, fallback: string): string => (failure instanceof Error ? failure.message : fallback)

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

/**
 * The agents of one workspace: who answers in its conversations, with which key, model and prompts. A conversation is
 * started with one of them, and editing an agent applies to its conversations from their next message.
 */
export function WorkspaceAgents({
  workspace,
  onOpenProviders,
}: {
  workspace: WorkspaceSummary
  onOpenProviders: () => void
}) {
  const [agents, setAgents] = useState<ChatAgent[] | null>(null)
  const [archived, setArchived] = useState<ChatAgent[]>([])
  const [choices, setChoices] = useState<Choices | null>(null)
  // `new` is the create form; an id is that agent's editor; null is the list alone.
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listWorkspaceAgents(workspace.id),
      listWorkspaceAgents(workspace.id, true),
      listProviderLogins(),
      listProviderModels(),
      getWorkspaceProviders(workspace.id),
    ]).then(
      ([live, gone, logins, models, providers]) => {
        if (cancelled) return
        setAgents(live)
        setArchived(gone)
        setChoices(choicesOf(workspace, logins, models, providers))
        setError(null)
      },
      (failure: unknown) => {
        if (!cancelled) setError(messageOf(failure, 'the agents failed to load'))
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspace, nonce])

  const reload = (): void => setNonce((value) => value + 1)

  if (agents === null || choices === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {error === null ? (
          <>
            <Spinner /> Loading agents…
          </>
        ) : (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        )}
      </p>
    )
  }

  const current = agents.find((agent) => agent.id === editing)

  if (editing === 'new' || current !== undefined) {
    return (
      <AgentEditor
        key={editing}
        workspace={workspace}
        agent={current}
        choices={choices}
        onOpenProviders={onOpenProviders}
        onDone={() => {
          setEditing(null)
          reload()
        }}
      />
    )
  }

  const keyLabel = (id: string | null): string =>
    id === null ? 'workspace default key' : (choices.keys.find((key) => key.id === id)?.label ?? 'an unlinked key')

  return (
    <div className="flex max-w-3xl flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-muted-foreground">
          An agent is who answers in a conversation: its model, the key that pays for it, how hard it thinks and the
          prompts that steer it. Pick one when you start a conversation in this workspace.
        </p>
        <Button size="sm" onClick={() => setEditing('new')}>
          New agent
        </Button>
      </div>

      {choices.keys.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-muted-foreground">
          No key reaches this workspace yet, so its agents cannot answer.{' '}
          <button type="button" className="underline" onClick={onOpenProviders}>
            Link a key on the Providers tab
          </button>
          .
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {agents.map((agent) => (
          <li key={agent.id}>
            <button
              type="button"
              onClick={() => setEditing(agent.id)}
              className="flex w-full flex-col gap-1 rounded-md border p-3 text-left hover:bg-muted/50"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium">{agent.name}</span>
                {agent.isDefault ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Default
                  </Badge>
                ) : null}
              </span>
              {agent.description === '' ? null : <span className="text-muted-foreground">{agent.description}</span>}
              <span className="text-xs text-muted-foreground">
                {agent.modelId ?? `${DEFAULT_MODEL_ID} (default)`} · thinking {agent.thinkingLevel} ·{' '}
                {keyLabel(agent.credentialId)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {archived.length === 0 ? null : (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-muted-foreground">Archived agents ({archived.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {archived.map((agent) => (
              <li key={agent.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void setAgentArchived(workspace.id, agent.id, false).then(reload, (failure: unknown) =>
                      setError(messageOf(failure, 'the agent could not be restored')),
                    )
                  }
                >
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => {
                    if (!window.confirm(`Delete ${agent.name} and its archived conversations for good?`)) return
                    void deleteAgent(workspace.id, agent.id).then(reload, (failure: unknown) =>
                      setError(messageOf(failure, 'the agent could not be deleted')),
                    )
                  }}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** Create or edit one agent. Saving validates against the workspace on the server, which names what is wrong. */
function AgentEditor({
  workspace,
  agent,
  choices,
  onOpenProviders,
  onDone,
}: {
  workspace: WorkspaceSummary
  agent: ChatAgent | undefined
  choices: Choices
  onOpenProviders: () => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState<AgentDraft>(agent === undefined ? emptyDraft : draftOf(agent))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof AgentDraft>(field: K, value: AgentDraft[K]): void =>
    setDraft((current) => ({ ...current, [field]: value }))

  const run = (call: () => Promise<unknown>): void => {
    setBusy(true)
    setError(null)
    call().then(onDone, (failure: unknown) => {
      setBusy(false)
      setError(messageOf(failure, 'that did not work'))
    })
  }

  const save = (): void =>
    run(() =>
      agent === undefined ? createAgent(workspace.id, draft) : updateAgent(workspace.id, agent.id, draft),
    )

  // An agent may still name a key or model the workspace has since stopped offering; it stays selectable as itself.
  const keyMissing = draft.credentialId !== null && !choices.keys.some((key) => key.id === draft.credentialId)
  const modelMissing = draft.modelId !== null && !choices.models.some((model) => model.id === draft.modelId)

  return (
    <form
      className="flex max-w-2xl flex-col gap-4 text-sm"
      aria-label={agent === undefined ? 'New agent' : `Edit ${agent.name}`}
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          ← Agents
        </Button>
        <h2 className="font-medium">{agent === undefined ? 'New agent' : agent.name}</h2>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="agent-name">Name</Label>
        <Input id="agent-name" required value={draft.name} onChange={(event) => set('name', event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="agent-description">Description</Label>
        <Input
          id="agent-description"
          placeholder="What this agent is for"
          value={draft.description}
          onChange={(event) => set('description', event.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-model">Model</Label>
          <select
            id="agent-model"
            className={selectClass}
            value={draft.modelId ?? ''}
            onChange={(event) => set('modelId', event.target.value === '' ? null : event.target.value)}
          >
            <option value="">Default ({DEFAULT_MODEL_ID})</option>
            {modelMissing && draft.modelId !== null ? (
              <option value={draft.modelId}>{draft.modelId} (not allowed here)</option>
            ) : null}
            {choices.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-key">Key</Label>
          <select
            id="agent-key"
            className={selectClass}
            value={draft.credentialId ?? ''}
            onChange={(event) => set('credentialId', event.target.value === '' ? null : event.target.value)}
          >
            <option value="">Workspace default</option>
            {keyMissing ? <option value={draft.credentialId ?? ''}>A key not linked here</option> : null}
            {choices.keys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-thinking">Thinking</Label>
          <select
            id="agent-thinking"
            className={selectClass}
            value={draft.thinkingLevel}
            onChange={(event) => {
              const level = THINKING_LEVELS.find((candidate) => candidate === event.target.value)
              if (level !== undefined) set('thinkingLevel', level)
            }}
          >
            {THINKING_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
      </div>

      {choices.keys.length === 0 ? (
        <p className="text-muted-foreground">
          No key reaches this workspace yet.{' '}
          <button type="button" className="underline" onClick={onOpenProviders}>
            Link one on the Providers tab
          </button>{' '}
          or the agent cannot answer.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="agent-system">System prompt</Label>
        <Textarea
          id="agent-system"
          rows={5}
          placeholder="Who the agent is and how it should behave."
          value={draft.systemPrompt}
          onChange={(event) => set('systemPrompt', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="agent-instructions">Instructions</Label>
        <Textarea
          id="agent-instructions"
          rows={4}
          placeholder="Standing instructions added after the system prompt."
          value={draft.instructions}
          onChange={(event) => set('instructions', event.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          Changes apply to this agent&rsquo;s conversations from their next message.
        </span>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || draft.name.trim() === ''}>
          {agent === undefined ? 'Create agent' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {agent !== undefined && !agent.isDefault ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Archive ${agent.name}? Its conversations are archived with it.`)) return
              run(() => setAgentArchived(workspace.id, agent.id, true))
            }}
          >
            Archive
          </Button>
        ) : null}
      </div>
    </form>
  )
}
