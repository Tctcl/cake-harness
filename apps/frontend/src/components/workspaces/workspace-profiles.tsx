import { useEffect, useState } from 'react'

import type { AgentDraft } from '../../lib/agent-api.ts'
import { createAgent, deleteAgent, listWorkspaceAgents, setAgentArchived, updateAgent } from '../../lib/agent-api.ts'
import type { ChatAgent, WorkspaceSummary } from '../../lib/chat-api.ts'
import { getWorkspaceProviders, listProviderLogins, listProviderModels } from '../../lib/provider-api.ts'
import type { ChatSubagent, SubagentDraft } from '../../lib/subagent-api.ts'
import {
  createSubagent,
  deleteSubagent,
  listWorkspaceSubagents,
  setSubagentArchived,
  updateSubagent,
} from '../../lib/subagent-api.ts'
import { choicesOf } from '../../lib/workspace-choices.ts'
import type { Choices } from '../../lib/workspace-choices.ts'
import { MasterDetail } from '../layout/master-detail.tsx'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Spinner } from '../ui/spinner.tsx'
import type { ProfileEditorDraft, ProfileKind } from './profile-editor.tsx'
import { ProfileEditor } from './profile-editor.tsx'

interface ProfileData {
  readonly agents: readonly ChatAgent[]
  readonly archivedAgents: readonly ChatAgent[]
  readonly subagents: readonly ChatSubagent[]
  readonly archivedSubagents: readonly ChatSubagent[]
  readonly choices: Choices
}

const messageOf = (failure: unknown, fallback: string): string => (failure instanceof Error ? failure.message : fallback)

/** One implementation for the two profile catalogs; their API and the editor's extra fields are the only differences. */
export function WorkspaceProfiles({
  kind,
  workspace,
  onOpenProviders,
}: {
  readonly kind: ProfileKind
  readonly workspace: WorkspaceSummary
  readonly onOpenProviders: () => void
}) {
  const [data, setData] = useState<ProfileData | null>(null)
  // `new` is the create form; an id is that profile's editor; null is the list alone.
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  // Bump when a load lands, not when it starts: remounting on the stale list made a save look undone until reopening.
  const [loaded, setLoaded] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listWorkspaceAgents(workspace.id),
      listWorkspaceAgents(workspace.id, true),
      listWorkspaceSubagents(workspace.id),
      listWorkspaceSubagents(workspace.id, true),
      listProviderLogins(),
      listProviderModels(),
      getWorkspaceProviders(workspace.id),
    ]).then(
      ([agents, archivedAgents, subagents, archivedSubagents, logins, models, providers]) => {
        if (cancelled) return
        setData({
          agents,
          archivedAgents,
          subagents,
          archivedSubagents,
          choices: choicesOf(workspace, logins, models, providers),
        })
        setError(null)
        setLoaded((value) => value + 1)
      },
      (failure: unknown) => {
        if (!cancelled) {
          setError(messageOf(failure, `the ${kind === 'agent' ? 'agents' : 'sub agents'} failed to load`))
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [kind, workspace, nonce])

  const reload = (): void => setNonce((value) => value + 1)

  if (data === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {error === null ? (
          <>
            <Spinner /> Loading {kind === 'agent' ? 'agents' : 'sub agents'}…
          </>
        ) : (
          <span role="alert" className="text-destructive">
            {error}
          </span>
        )}
      </p>
    )
  }

  const profiles: readonly (ChatAgent | ChatSubagent)[] = kind === 'agent' ? data.agents : data.subagents
  const archived: readonly (ChatAgent | ChatSubagent)[] = kind === 'agent' ? data.archivedAgents : data.archivedSubagents
  const current = profiles.find((profile) => profile.id === editing)
  const noun = kind === 'agent' ? 'agent' : 'sub agent'
  const archivedGroup = archived.length === 0 ? null : (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-muted-foreground">
        Archived {kind === 'agent' ? 'agents' : 'sub agents'} ({archived.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {archived.map((profile) => (
          <li key={profile.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{profile.name}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void (kind === 'agent'
                  ? setAgentArchived(workspace.id, profile.id, false)
                  : setSubagentArchived(workspace.id, profile.id, false)
                ).then(reload, (failure: unknown) =>
                  setError(messageOf(failure, `the ${noun} could not be restored`)),
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
                const warning = kind === 'agent'
                  ? `Delete ${profile.name} and its archived conversations for good?`
                  : `Delete ${profile.name} for good? Sub agents named by delegation history cannot be deleted.`
                if (!window.confirm(warning)) return
                void (kind === 'agent'
                  ? deleteAgent(workspace.id, profile.id)
                  : deleteSubagent(workspace.id, profile.id)
                ).then(reload, (failure: unknown) =>
                  setError(messageOf(failure, `the ${noun} could not be deleted`)),
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

  const saveProfile = async (draft: ProfileEditorDraft): Promise<string> => {
    const base: AgentDraft = {
      name: draft.name,
      description: draft.description,
      allowAll: draft.allowAll,
      systemPromptAppend: draft.systemPromptAppend,
      instructions: draft.instructions,
      credentialId: draft.credentialId,
      modelId: draft.modelId,
      thinkingLevel: draft.thinkingLevel,
    }

    if (kind === 'agent') {
      const saved = current === undefined
        ? await createAgent(workspace.id, base)
        : await updateAgent(workspace.id, current.id, base)
      return saved.id
    }

    if (draft.modelId === null) throw new Error('choose a default model')
    const subagent: SubagentDraft = {
      ...base,
      modelId: draft.modelId,
      allowedModels: [...new Set([draft.modelId, ...draft.allowedModels])],
      callableBy: draft.callableBy,
    }
    const saved = current === undefined
      ? await createSubagent(workspace.id, subagent)
      : await updateSubagent(workspace.id, current.id, subagent)
    return saved.id
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="max-w-3xl text-muted-foreground">
        {kind === 'agent'
          ? 'An agent is who answers in a conversation: its model, key, thinking level, prompt and tools. Pick one when you start a conversation in this workspace.'
          : 'A sub agent is a throwaway worker a parent agent calls with delegate. Set its default and allowed models, which agents may call it, and the prompt and tools each delegation gets.'}
      </p>
      {data.choices.keys.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-muted-foreground">
          No key reaches this workspace yet, so its {kind === 'agent' ? 'agents' : 'sub agents'} cannot answer.{' '}
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
        listLabel={kind === 'agent' ? 'Agents' : 'Sub agents'}
        newLabel={kind === 'agent' ? 'New agent' : 'New sub agent'}
        items={profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          detail: profile.description,
          badge: 'isDefault' in profile && profile.isDefault
            ? <Badge variant="secondary" className="text-[10px]">Default</Badge>
            : undefined,
        }))}
        selection={editing}
        onSelect={setEditing}
        emptyText={kind === 'agent' ? 'No agents yet.' : 'No sub agents yet.'}
        archived={archivedGroup}
        renderDetail={() => (
          <ProfileEditor
            key={`${kind}-${editing}-${loaded}`}
            kind={kind}
            profile={current}
            workspace={workspace}
            choices={data.choices}
            callableAgents={data.agents}
            delegatesTo={current === undefined ? [] : data.subagents
              .filter((subagent) => subagent.callableBy.includes(current.id))
              .map((subagent) => subagent.name)}
            onOpenProviders={onOpenProviders}
            onDone={(savedId) => {
              // A save keeps that profile open (a new one becomes the selection); archive or cancel returns to the list.
              setEditing(savedId ?? null)
              reload()
            }}
            onSave={saveProfile}
            onArchive={async () => {
              if (current === undefined) return
              if (kind === 'agent') await setAgentArchived(workspace.id, current.id, true)
              else await setSubagentArchived(workspace.id, current.id, true)
            }}
          />
        )}
      />
    </div>
  )
}
