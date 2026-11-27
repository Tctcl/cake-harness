import { useEffect, useState } from 'react'

import type { AgentDraft } from '../../lib/agent-api.ts'
import type { CatalogTool, ChatAgentGrants } from '../../lib/capability-api.ts'
import { getAgentGrants, listTools, setAgentGrants } from '../../lib/capability-api.ts'
import type { ChatAgent, WorkspaceSummary } from '../../lib/chat-api.ts'
import { DEFAULT_MODEL_ID, THINKING_LEVELS } from '../../lib/chat-api.ts'
import type { ChatSubagent } from '../../lib/subagent-api.ts'
import type { Choices } from '../../lib/workspace-choices.ts'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'
import { Label } from '../ui/label.tsx'
import { Spinner } from '../ui/spinner.tsx'
import { Textarea } from '../ui/textarea.tsx'

export type ProfileKind = 'agent' | 'subagent'
export type EditableProfile = ChatAgent | ChatSubagent

/** The common editor state; only the sub agent save path sends the final two collections. */
export interface ProfileEditorDraft extends AgentDraft {
  readonly allowedModels: readonly string[]
  readonly callableBy: readonly string[]
}

const messageOf = (failure: unknown, fallback: string): string => (failure instanceof Error ? failure.message : fallback)

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

const ENVIRONMENT_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit', 'bash'])
const SUBAGENT_EXCLUDED_TOOLS: ReadonlySet<string> = new Set(['ask_user', 'delegate'])

const emptyDraft = (kind: ProfileKind, choices: Choices): ProfileEditorDraft => {
  const firstModel = kind === 'subagent' ? choices.models[0]?.id ?? null : null

  return {
    name: '',
    description: '',
    allowAll: true,
    systemPromptAppend: '',
    instructions: '',
    credentialId: null,
    modelId: firstModel,
    thinkingLevel: 'low',
    allowedModels: firstModel === null ? [] : [firstModel],
    callableBy: [],
  }
}

const draftOf = (profile: EditableProfile): ProfileEditorDraft => ({
  name: profile.name,
  description: profile.description,
  allowAll: profile.allowAll,
  systemPromptAppend: profile.systemPromptAppend,
  instructions: profile.instructions,
  credentialId: profile.credentialId,
  modelId: profile.modelId,
  thinkingLevel: profile.thinkingLevel,
  allowedModels: 'allowedModels' in profile ? profile.allowedModels : [],
  callableBy: 'callableBy' in profile ? profile.callableBy : [],
})

/** Create or edit either profile kind. Saving validates against the workspace on the server, which names what is wrong. */
export function ProfileEditor({
  kind,
  profile,
  workspace,
  choices,
  callableAgents,
  delegatesTo,
  onOpenProviders,
  onDone,
  onSave,
  onArchive,
}: {
  readonly kind: ProfileKind
  readonly profile: EditableProfile | undefined
  readonly workspace: WorkspaceSummary
  readonly choices: Choices
  readonly callableAgents: readonly ChatAgent[]
  readonly delegatesTo: readonly string[]
  readonly onOpenProviders: () => void
  /** Called with the saved profile's id after a save, and with nothing after archive or cancel. */
  readonly onDone: (savedId?: string) => void
  readonly onSave: (draft: ProfileEditorDraft) => Promise<string>
  readonly onArchive: () => Promise<void>
}) {
  const [draft, setDraft] = useState<ProfileEditorDraft>(() =>
    profile === undefined ? emptyDraft(kind, choices) : draftOf(profile),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tools, setTools] = useState<CatalogTool[] | null>(null)
  const [grants, setGrants] = useState<ChatAgentGrants | null>(null)
  const [selectedTools, setSelectedTools] = useState<readonly string[]>([])

  useEffect(() => {
    let cancelled = false
    const loadGrants = profile === undefined
      ? Promise.resolve<ChatAgentGrants>({ tools: [], skills: [], mcpServers: [] })
      : getAgentGrants(profile.id)
    void Promise.all([listTools(), loadGrants]).then(
      ([catalog, linked]) => {
        if (cancelled) return
        const excluded = kind === 'subagent'
          ? new Set(catalog.filter((tool) => SUBAGENT_EXCLUDED_TOOLS.has(tool.name)).map((tool) => tool.id))
          : new Set<string>()
        setTools(catalog)
        setGrants(linked)
        setSelectedTools(linked.tools.filter((id) => !excluded.has(id)))
      },
      (failure: unknown) => {
        if (!cancelled) setError(messageOf(failure, 'the tools failed to load'))
      },
    )

    return () => {
      cancelled = true
    }
  }, [kind, profile])

  const set = <K extends keyof ProfileEditorDraft>(field: K, value: ProfileEditorDraft[K]): void =>
    setDraft((current) => ({ ...current, [field]: value }))

  const run = (call: () => Promise<string | undefined>): void => {
    setBusy(true)
    setError(null)
    call().then(onDone, (failure: unknown) => {
      setBusy(false)
      setError(messageOf(failure, 'that did not work'))
    })
  }

  const save = (): void =>
    run(async () => {
      if (grants === null || tools === null) throw new Error('the tools are still loading')
      const savedId = await onSave(draft)
      const excluded = kind === 'subagent'
        ? new Set(tools.filter((tool) => SUBAGENT_EXCLUDED_TOOLS.has(tool.name)).map((tool) => tool.id))
        : new Set<string>()
      await setAgentGrants(savedId, {
        tools: selectedTools.filter((id) => !excluded.has(id)),
        skills: grants.skills,
        mcpServers: grants.mcpServers,
      })

      return savedId
    })

  // A profile may still name a key or model the workspace has since stopped offering; it stays visible as itself.
  const keyMissing = draft.credentialId !== null && !choices.keys.some((key) => key.id === draft.credentialId)
  const modelMissing = draft.modelId !== null && !choices.models.some((model) => model.id === draft.modelId)
  const modelOptions = kind === 'subagent'
    ? [...new Set([
        ...choices.models.map((model) => model.id),
        ...draft.allowedModels,
        ...(draft.modelId === null ? [] : [draft.modelId]),
      ])].map((id) => ({
        id,
        name: choices.models.find((model) => model.id === id)?.name ?? id,
        reachable: choices.models.some((model) => model.id === id),
      }))
    : []
  const visibleTools = tools?.filter((tool) => kind === 'agent' || !SUBAGENT_EXCLUDED_TOOLS.has(tool.name)) ?? null
  const noun = kind === 'agent' ? 'agent' : 'sub agent'
  const isDefaultAgent = kind === 'agent' && profile !== undefined && 'isDefault' in profile && profile.isDefault

  return (
    <form
      className="flex max-w-3xl flex-col gap-4 text-sm"
      aria-label={profile === undefined ? `New ${noun}` : `Edit ${profile.name}`}
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <h2 className="font-medium">{profile === undefined ? `New ${noun}` : profile.name}</h2>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${kind}-name`}>Name</Label>
        <Input id={`${kind}-name`} required value={draft.name} onChange={(event) => set('name', event.target.value)} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${kind}-description`}>Description</Label>
        <Input
          id={`${kind}-description`}
          placeholder={kind === 'agent' ? 'What this agent is for' : 'What a parent should delegate to this sub agent'}
          value={draft.description}
          onChange={(event) => set('description', event.target.value)}
        />
      </div>

      {kind === 'agent' ? (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground">
          Can delegate to: {delegatesTo.length === 0 ? 'No sub agents' : delegatesTo.join(', ')}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${kind}-model`}>{kind === 'agent' ? 'Model' : 'Default model'}</Label>
          <select
            id={`${kind}-model`}
            className={selectClass}
            value={draft.modelId ?? ''}
            onChange={(event) => {
              const modelId = event.target.value === '' ? null : event.target.value
              setDraft((current) => ({
                ...current,
                modelId,
                allowedModels: kind === 'subagent' && modelId !== null
                  ? [...new Set([...current.allowedModels, modelId])]
                  : current.allowedModels,
              }))
            }}
          >
            {kind === 'agent' ? <option value="">Default ({DEFAULT_MODEL_ID})</option> : null}
            {kind === 'subagent' && draft.modelId === null ? <option value="">Select a model</option> : null}
            {kind === 'agent' && modelMissing && draft.modelId !== null ? (
              <option value={draft.modelId}>{draft.modelId} (not allowed here)</option>
            ) : null}
            {kind === 'agent'
              ? choices.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)
              : modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}{model.reachable ? '' : ' (not allowed here)'}
                  </option>
                ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${kind}-key`}>Key</Label>
          <select
            id={`${kind}-key`}
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
          <Label htmlFor={`${kind}-thinking`}>{kind === 'agent' ? 'Thinking' : 'Default thinking'}</Label>
          <select
            id={`${kind}-thinking`}
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

      {kind === 'subagent' ? (
        <fieldset className="flex flex-col gap-2 rounded-md border p-4">
          <legend className="px-1 font-medium">Allowed models</legend>
          <p className="text-xs text-muted-foreground">
            The default is always allowed. A parent should choose another model only when the task needs it.
          </p>
          {modelOptions.length === 0 ? (
            <p className="text-muted-foreground">No models reach this workspace.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {modelOptions.map((model) => {
                const isDefault = model.id === draft.modelId
                const id = `subagent-model-${model.id}`
                return (
                  <label key={model.id} className="flex items-center gap-2" htmlFor={id}>
                    <input
                      id={id}
                      type="checkbox"
                      className="size-4 accent-foreground"
                      aria-label={`Allowed model ${model.name}`}
                      checked={isDefault || draft.allowedModels.includes(model.id)}
                      disabled={isDefault}
                      onChange={() => {
                        if (isDefault) return
                        set('allowedModels', draft.allowedModels.includes(model.id)
                          ? draft.allowedModels.filter((candidate) => candidate !== model.id)
                          : [...draft.allowedModels, model.id])
                      }}
                    />
                    <span>{model.name}{isDefault ? ' (default)' : ''}</span>
                    {model.reachable ? null : <span className="text-xs text-muted-foreground">(not allowed here)</span>}
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>
      ) : null}

      {choices.keys.length === 0 ? (
        <p className="text-muted-foreground">
          No key reaches this workspace yet.{' '}
          <button type="button" className="underline" onClick={onOpenProviders}>
            Link one on the Providers tab
          </button>{' '}
          or the {noun} cannot answer.
        </p>
      ) : null}

      <section className="flex flex-col gap-3 rounded-md border p-4" aria-labelledby={`${kind}-tools-heading`}>
        <h3 id={`${kind}-tools-heading`} className="font-medium">Tools</h3>
        <label className="flex items-center gap-2" htmlFor={`${kind}-allow-all`}>
          <input
            id={`${kind}-allow-all`}
            type="checkbox"
            className="size-4 accent-foreground"
            checked={draft.allowAll}
            onChange={(event) => set('allowAll', event.target.checked)}
          />
          All tools available here
        </label>
        {!draft.allowAll && visibleTools !== null ? (
          <div className="flex flex-col gap-2">
            {visibleTools.map((tool) => {
              const unavailable = workspace.isDefault && ENVIRONMENT_TOOLS.has(tool.name)
              const id = `${kind}-tool-${tool.id}`
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
                      <span className="text-xs text-muted-foreground">Unavailable to General’s agent</span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {!draft.allowAll && visibleTools === null ? (
          <span className="flex items-center gap-2 text-muted-foreground"><Spinner /> Loading tools…</span>
        ) : null}
      </section>

      {kind === 'subagent' ? (
        <fieldset className="flex flex-col gap-2 rounded-md border p-4">
          <legend className="px-1 font-medium">Callable by</legend>
          <p className="text-xs text-muted-foreground">Only these agents receive a delegate tool for this sub agent.</p>
          {callableAgents.length === 0 ? <p className="text-muted-foreground">No live agents in this workspace.</p> : null}
          {callableAgents.map((agent) => {
            const id = `subagent-caller-${agent.id}`
            return (
              <label key={agent.id} className="flex items-center gap-2" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={draft.callableBy.includes(agent.id)}
                  onChange={() => set('callableBy', draft.callableBy.includes(agent.id)
                    ? draft.callableBy.filter((candidate) => candidate !== agent.id)
                    : [...draft.callableBy, agent.id])}
                />
                {agent.name}
              </label>
            )
          })}
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${kind}-system`}>System prompt append</Label>
        <Textarea
          id={`${kind}-system`}
          rows={5}
          placeholder={`Extra context or personality for this ${noun}.`}
          value={draft.systemPromptAppend}
          onChange={(event) => set('systemPromptAppend', event.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          Added after Cake’s {kind === 'subagent' ? 'sub agent system prompt' : 'base system prompt'}.
        </span>
        <span className="text-xs text-muted-foreground">
          Applies to new conversations; running ones keep the text they started with.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${kind}-instructions`}>Instructions</Label>
        <Textarea
          id={`${kind}-instructions`}
          rows={4}
          placeholder="Standing instructions added after the system prompt."
          value={draft.instructions}
          onChange={(event) => set('instructions', event.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {kind === 'agent'
            ? 'Changes apply to this agent’s conversations from their next message.'
            : 'Changes apply from this sub agent’s next delegation.'}
        </span>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={
            busy ||
            grants === null ||
            tools === null ||
            draft.name.trim() === '' ||
            (kind === 'subagent' && (draft.modelId === null || draft.allowedModels.length === 0))
          }
        >
          {profile === undefined ? `Create ${noun}` : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        {profile !== undefined && !isDefaultAgent ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive"
            disabled={busy}
            onClick={() => {
              const warning = kind === 'agent'
                ? `Archive ${profile.name}? Its conversations are archived with it.`
                : `Archive ${profile.name}? Parent agents will no longer be able to call it.`
              if (!window.confirm(warning)) return
              run(async () => {
                await onArchive()
                return undefined
              })
            }}
          >
            Archive
          </Button>
        ) : null}
      </div>
    </form>
  )
}
