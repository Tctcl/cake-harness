import { useEffect, useState } from 'react'

import type { AgentDraft } from '../../lib/agent-api.ts'
import { createAgent, deleteAgent, listWorkspaceAgents, setAgentArchived, updateAgent } from '../../lib/agent-api.ts'
import type { CatalogTool, ChatAgentGrants } from '../../lib/capability-api.ts'
import { getAgentGrants, listTools, setAgentGrants } from '../../lib/capability-api.ts'
import type { ChatAgent, WorkspaceSummary } from '../../lib/chat-api.ts'
import { DEFAULT_MODEL_ID, THINKING_LEVELS } from '../../lib/chat-api.ts'
import { getWorkspaceProviders, listProviderLogins, listProviderModels } from '../../lib/provider-api.ts'
import { choicesOf } from '../../lib/workspace-choices.ts'
import type { Choices } from '../../lib/workspace-choices.ts'
import { MasterDetail } from '../layout/master-detail.tsx'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Label } from '../ui/label.tsx'
import { Spinner } from '../ui/spinner.tsx'
import { Textarea } from '../ui/textarea.tsx'

const emptyDraft: AgentDraft = {
  name: '',
  description: '',
  allowAll: true,
  systemPrompt: '',
  instructions: '',
  credentialId: null,
  modelId: null,
  thinkingLevel: 'low',
}

const draftOf = (agent: ChatAgent): AgentDraft => ({
  name: agent.name,
  description: agent.description,
  allowAll: agent.allowAll,
  systemPrompt: agent.systemPrompt,
  instructions: agent.instructions,
  credentialId: agent.credentialId,
  modelId: agent.modelId,
  thinkingLevel: agent.thinkingLevel,
})

const messageOf = (failure: unknown, fallback: string): string => (failure instanceof Error ? failure.message : fallback)

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

const ENVIRONMENT_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit', 'bash'])

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
  const archivedGroup = archived.length === 0 ? null : (
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
  )

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="max-w-3xl text-muted-foreground">
        An agent is who answers in a conversation: its model, key, thinking level, prompt and tools. Pick one when you
        start a conversation in this workspace.
      </p>
      {choices.keys.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-muted-foreground">
          No key reaches this workspace yet, so its agents cannot answer.{' '}
          <button type="button" className="underline" onClick={onOpenProviders}>
            Link a key on the Providers tab
          </button>
          .
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <MasterDetail
        listLabel="Agents"
        newLabel="New agent"
        items={agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          detail: agent.description,
          badge: agent.isDefault ? <Badge variant="secondary" className="text-[10px]">Default</Badge> : undefined,
        }))}
        selection={editing}
        onSelect={setEditing}
        emptyText="No agents yet."
        archived={archivedGroup}
        renderDetail={() => (
          <AgentEditor
            key={`${editing}-${nonce}`}
            workspace={workspace}
            agent={current}
            starterPrompt={agents.find((agent) => agent.isDefault)?.systemPrompt ?? ''}
            choices={choices}
            onOpenProviders={onOpenProviders}
            onDone={() => {
              setEditing(null)
              reload()
            }}
          />
        )}
      />
    </div>
  )
}

/** Create or edit one agent. Saving validates against the workspace on the server, which names what is wrong. */
function AgentEditor({
  workspace,
  agent,
  starterPrompt,
  choices,
  onOpenProviders,
  onDone,
}: {
  workspace: WorkspaceSummary
  agent: ChatAgent | undefined
  /** The default agent's system prompt: a new agent starts from a working prompt rather than from a blank box. */
  starterPrompt: string
  choices: Choices
  onOpenProviders: () => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState<AgentDraft>(
    agent === undefined ? { ...emptyDraft, systemPrompt: starterPrompt } : draftOf(agent),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tools, setTools] = useState<CatalogTool[] | null>(null)
  const [grants, setGrants] = useState<ChatAgentGrants | null>(null)
  const [selectedTools, setSelectedTools] = useState<readonly string[]>([])

  useEffect(() => {
    let cancelled = false
    const loadGrants = agent === undefined
      ? Promise.resolve<ChatAgentGrants>({ tools: [], skills: [], mcpServers: [] })
      : getAgentGrants(agent.id)
    void Promise.all([listTools(), loadGrants]).then(
      ([catalog, linked]) => {
        if (cancelled) return
        setTools(catalog)
        setGrants(linked)
        setSelectedTools(linked.tools)
      },
      (failure: unknown) => {
        if (!cancelled) setError(messageOf(failure, 'the tools failed to load'))
      },
    )

    return () => {
      cancelled = true
    }
  }, [agent])

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
    run(async () => {
      if (grants === null) throw new Error('the tools are still loading')
      const saved = agent === undefined
        ? await createAgent(workspace.id, draft)
        : await updateAgent(workspace.id, agent.id, draft)
      await setAgentGrants(saved.id, {
        tools: selectedTools,
        skills: grants.skills,
        mcpServers: grants.mcpServers,
      })
    })

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
      <h2 className="font-medium">{agent === undefined ? 'New agent' : agent.name}</h2>

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

      <section className="flex flex-col gap-3 rounded-md border p-4" aria-labelledby="agent-tools-heading">
        <h3 id="agent-tools-heading" className="font-medium">Tools</h3>
        <label className="flex items-center gap-2" htmlFor="agent-allow-all">
          <input
            id="agent-allow-all"
            type="checkbox"
            className="size-4 accent-foreground"
            checked={draft.allowAll}
            onChange={(event) => set('allowAll', event.target.checked)}
          />
          All tools available here
        </label>
        {!draft.allowAll && tools !== null ? (
          <div className="flex flex-col gap-2">
            {tools.map((tool) => {
              const unavailable = workspace.isDefault && ENVIRONMENT_TOOLS.has(tool.name)
              const id = `agent-tool-${tool.id}`
              return (
                <div key={tool.id} className={`flex items-start gap-3 ${unavailable ? 'opacity-50' : ''}`}>
                  <input
                    id={id}
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-foreground"
                    checked={selectedTools.includes(tool.id)}
                    disabled={unavailable}
                    onChange={() =>
                      setSelectedTools((current) =>
                        current.includes(tool.id) ? current.filter((id) => id !== tool.id) : [...current, tool.id],
                      )
                    }
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Label htmlFor={id}>{tool.name}</Label>
                    <span className="break-words text-xs text-muted-foreground">{tool.description}</span>
                    {unavailable ? (
                      <span className="text-xs text-muted-foreground">Needs a workspace container</span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {!draft.allowAll && tools === null ? (
          <span className="flex items-center gap-2 text-muted-foreground"><Spinner /> Loading tools…</span>
        ) : null}
      </section>

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
        <Button type="submit" size="sm" disabled={busy || grants === null || tools === null || draft.name.trim() === ''}>
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
