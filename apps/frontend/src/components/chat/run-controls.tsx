import { useState } from 'react'

import type { ChatAgent, ChatThread, RunSettingsPatch } from '../../lib/chat-api.ts'
import { DEFAULT_MODEL_ID, THINKING_LEVELS, updateThreadRunSettings } from '../../lib/chat-api.ts'
import type { Choices } from '../../lib/workspace-choices.ts'

const selectClass =
  'h-7 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50'

/** Quick settings for one conversation. Empty select values are the null overrides stored on the thread. */
export function RunControls({
  thread,
  agent,
  choices,
  onChange,
  onError,
}: {
  thread: ChatThread
  agent: ChatAgent
  choices: Choices
  onChange: (thread: ChatThread) => void
  onError: (message: string | null) => void
}) {
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

  const change = (patch: RunSettingsPatch): void => {
    const previous = thread
    setBusy(true)
    onError(null)
    onChange({ ...thread, overrides: { ...thread.overrides, ...patch } })

    void updateThreadRunSettings(thread.id, patch).then(
      (updated) => {
        onChange(updated)
        setBusy(false)
      },
      (failure: unknown) => {
        onChange(previous)
        onError(failure instanceof Error ? failure.message : 'the run settings could not be saved')
        setBusy(false)
      },
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-start gap-2" aria-label="Conversation run settings">
      <select
        aria-label="Model"
        className={selectClass}
        disabled={busy}
        value={thread.overrides.modelId ?? ''}
        onChange={(event) => change({ modelId: event.target.value === '' ? null : event.target.value })}
      >
        <option value="">Agent default ({defaultModelId})</option>
        {modelMissing ? (
          <option value={thread.overrides.modelId ?? ''}>{thread.overrides.modelId} (not allowed here)</option>
        ) : null}
        {choices.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Thinking"
        className={selectClass}
        disabled={busy}
        value={thread.overrides.thinkingLevel ?? ''}
        onChange={(event) => {
          const level = THINKING_LEVELS.find((candidate) => candidate === event.target.value)
          if (event.target.value === '') change({ thinkingLevel: null })
          if (level !== undefined) change({ thinkingLevel: level })
        }}
      >
        <option value="">Agent default ({agent.thinkingLevel})</option>
        {THINKING_LEVELS.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>

      <select
        aria-label="Key"
        className={selectClass}
        disabled={busy}
        value={thread.overrides.credentialId ?? ''}
        onChange={(event) => change({ credentialId: event.target.value === '' ? null : event.target.value })}
      >
        <option value="">Agent default ({defaultKeyLabel})</option>
        {keyMissing ? (
          <option value={thread.overrides.credentialId ?? ''}>A key not linked here</option>
        ) : null}
        {choices.keys.map((key) => (
          <option key={key.id} value={key.id}>
            {key.label}
          </option>
        ))}
      </select>
    </div>
  )
}
