import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'

import type { ChatAgent, ChatThread, RunSettingsOverrideKey, RunSettingsPatch } from '../../lib/chat-api.ts'
import {
  DEFAULT_MODEL_ID,
  THINKING_LEVELS,
  switchThreadAgent,
  updateThreadRunSettings,
} from '../../lib/chat-api.ts'
import type { Choices } from '../../lib/workspace-choices.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.tsx'

/** The value a radio item uses for "no override": Radix reserves the empty string for "no selection". */
const AGENT_DEFAULT = 'agent-default'

/** How a dropped override is named to the reader: the column name is the backend's, not theirs. */
const OVERRIDE_LABELS: Record<RunSettingsOverrideKey, string> = {
  credentialId: 'key',
  modelId: 'model',
  thinkingLevel: 'thinking level',
}

const triggerClass =
  'flex h-7 min-w-0 max-w-[11rem] items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 disabled:hover:bg-transparent'

/** The workspace's agents, and what the current agent runs with unless this conversation overrides it. */
export interface ComposerAgentState {
  readonly thread: ChatThread
  readonly agent: ChatAgent
  readonly agents: readonly ChatAgent[]
  readonly choices: Choices
}

/**
 * Quick settings for one conversation, inside the composer's box: who answers it, and the model, thinking level and key
 * its next message runs with. Every change is written immediately and reverted if the backend refuses it.
 */
export function RunControls({
  value,
  onChange,
  onError,
}: {
  value: ComposerAgentState
  onChange: (next: { readonly thread: ChatThread; readonly agent: ChatAgent }) => void
  onError: (message: string | null) => void
}) {
  const { thread, agent, agents, choices } = value
  const [busy, setBusy] = useState(false)

  const defaultModelId = agent.modelId ?? DEFAULT_MODEL_ID
  // This mirrors resolveRunSettings: an agent key no longer reachable here falls back to the newest usable key.
  const agentKeyUsable =
    agent.credentialId !== null && choices.keys.some((key) => key.id === agent.credentialId)
  const defaultCredentialId = agentKeyUsable ? agent.credentialId : (choices.keys[0]?.id ?? null)
  const defaultKey = choices.keys.find((key) => key.id === defaultCredentialId)
  const defaultKeyLabel = defaultKey?.label ?? defaultCredentialId ?? 'no key'
  const modelMissing =
    thread.overrides.modelId !== null && !choices.models.some((model) => model.id === thread.overrides.modelId)
  const keyMissing =
    thread.overrides.credentialId !== null &&
    !choices.keys.some((key) => key.id === thread.overrides.credentialId)

  const effectiveModelId = thread.overrides.modelId ?? defaultModelId
  const effectiveModelName =
    choices.models.find((model) => model.id === effectiveModelId)?.name ?? effectiveModelId
  const effectiveThinking = thread.overrides.thinkingLevel ?? agent.thinkingLevel

  const change = (patch: RunSettingsPatch): void => {
    const previous = thread
    setBusy(true)
    onError(null)
    onChange({ thread: { ...thread, overrides: { ...thread.overrides, ...patch } }, agent })

    void updateThreadRunSettings(thread.id, patch).then(
      (updated) => {
        onChange({ thread: updated, agent })
        setBusy(false)
      },
      (failure: unknown) => {
        onChange({ thread: previous, agent })
        onError(failure instanceof Error ? failure.message : 'the run settings could not be saved')
        setBusy(false)
      },
    )
  }

  const switchTo = (agentId: string): void => {
    const next = agents.find((candidate) => candidate.id === agentId)
    // The current agent is already checked in the menu: picking it writes nothing, so no divider is recorded.
    if (next === undefined || next.id === agent.id) return

    const previous = { thread, agent }
    setBusy(true)
    onError(null)
    // Optimistic, like the overrides: the menu closes on a name that is about to be right.
    onChange({ thread: { ...thread, agentId: next.id }, agent: next })

    void switchThreadAgent(thread.id, next.id).then(
      (switched) => {
        onChange({ thread: switched.thread, agent: next })
        const dropped = switched.clearedOverrides.map((key) => OVERRIDE_LABELS[key]).join(', ')
        onError(
          dropped === ''
            ? null
            : `This conversation’s ${dropped} setting no longer applies here, so it was cleared.`,
        )
        setBusy(false)
      },
      (failure: unknown) => {
        onChange(previous)
        onError(failure instanceof Error ? failure.message : 'the agent could not be switched')
        setBusy(false)
      },
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Conversation settings">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={triggerClass} aria-label={`Agent: ${agent.name}`} disabled={busy}>
            <span className="truncate font-medium text-foreground">{agent.name}</span>
            <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Agent</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={agent.id} onValueChange={switchTo}>
            {agents.map((candidate) => (
              <DropdownMenuRadioItem key={candidate.id} value={candidate.id} className="items-start">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{candidate.name}</span>
                  {candidate.description === '' ? null : (
                    <span className="text-xs text-muted-foreground">{candidate.description}</span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={triggerClass}
            aria-label={`Model and thinking: ${effectiveModelName}, ${effectiveThinking}`}
            disabled={busy}
          >
            <span className="truncate">{effectiveModelName}</span>
            <span aria-hidden className="shrink-0">·</span>
            <span className="shrink-0">{effectiveThinking}</span>
            <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Model</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={thread.overrides.modelId ?? AGENT_DEFAULT}
            onValueChange={(next) => change({ modelId: next === AGENT_DEFAULT ? null : next })}
          >
            <DropdownMenuRadioItem value={AGENT_DEFAULT}>
              <span className="truncate">Agent default ({defaultModelId})</span>
            </DropdownMenuRadioItem>
            {modelMissing ? (
              // Shown so the reader sees what is stored, and can pick another model: the backend would refuse a run.
              <DropdownMenuRadioItem value={thread.overrides.modelId ?? AGENT_DEFAULT}>
                <span className="truncate">{thread.overrides.modelId} (not allowed here)</span>
              </DropdownMenuRadioItem>
            ) : null}
            {choices.models.map((model) => (
              <DropdownMenuRadioItem key={model.id} value={model.id}>
                <span className="truncate">{model.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Thinking</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={thread.overrides.thinkingLevel ?? AGENT_DEFAULT}
                onValueChange={(next) => {
                  const level = THINKING_LEVELS.find((candidate) => candidate === next)
                  change({ thinkingLevel: level ?? null })
                }}
              >
                <DropdownMenuRadioItem value={AGENT_DEFAULT}>
                  Agent default ({agent.thinkingLevel})
                </DropdownMenuRadioItem>
                {THINKING_LEVELS.map((level) => (
                  <DropdownMenuRadioItem key={level} value={level}>
                    {level}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Key</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={thread.overrides.credentialId ?? AGENT_DEFAULT}
                onValueChange={(next) => change({ credentialId: next === AGENT_DEFAULT ? null : next })}
              >
                <DropdownMenuRadioItem value={AGENT_DEFAULT}>
                  Agent default ({defaultKeyLabel})
                </DropdownMenuRadioItem>
                {keyMissing ? (
                  <DropdownMenuRadioItem value={thread.overrides.credentialId ?? AGENT_DEFAULT}>
                    A key not linked here
                  </DropdownMenuRadioItem>
                ) : null}
                {choices.keys.map((key) => (
                  <DropdownMenuRadioItem key={key.id} value={key.id}>
                    {key.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
