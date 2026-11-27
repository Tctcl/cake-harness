import { GitBranchIcon, LoaderCircleIcon, WrenchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ChatDelegation, ChatMessage, ChatThread, WorkspaceSummary } from '../../lib/chat-api.ts'
import { listWorkspaceSubagents } from '../../lib/subagent-api.ts'
import { useThreadSnapshot } from '../../lib/use-thread-snapshot.ts'
import { Badge } from '../ui/badge.tsx'
import { ScrollArea } from '../ui/scroll-area.tsx'
import { LiveRun } from './live-run.tsx'
import { Markdown } from './markdown.tsx'

const EMPTY_MODELS: ReadonlyMap<string, string> = new Map()

const oneLine = (value: string): string => value.replaceAll(/\s+/g, ' ').trim()

/** The conversation's throwaway children, dense enough to scan while the parent continues working. */
export function DelegationsPanel({
  thread,
  workspace,
}: {
  readonly thread: ChatThread | null
  readonly workspace: WorkspaceSummary | null
}) {
  const state = useThreadSnapshot(thread?.id ?? null)
  const [models, setModels] = useState<{
    readonly workspaceId: string
    readonly bySubagent: ReadonlyMap<string, string>
  } | null>(null)
  const [modelError, setModelError] = useState<{ readonly workspaceId: string; readonly message: string } | null>(null)

  useEffect(() => {
    if (workspace === null) return
    let cancelled = false
    void Promise.all([
      listWorkspaceSubagents(workspace.id),
      listWorkspaceSubagents(workspace.id, true),
    ]).then(
      ([live, archived]) => {
        if (cancelled) return
        setModels({
          workspaceId: workspace.id,
          bySubagent: new Map([...archived, ...live].map((subagent) => [subagent.id, subagent.modelId])),
        })
        setModelError(null)
      },
      (failure: unknown) => {
        if (!cancelled) {
          setModelError({
            workspaceId: workspace.id,
            message: failure instanceof Error ? failure.message : 'the sub agent models failed to load',
          })
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [workspace])

  const modelMap = models !== null && models.workspaceId === workspace?.id ? models.bySubagent : EMPTY_MODELS
  const visibleModelError = modelError !== null && modelError.workspaceId === workspace?.id ? modelError.message : null
  const delegations = [...state.delegations].reverse()

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-2 p-3">
        <div>
          <h2 className="text-sm font-medium">Sub agents</h2>
          <p className="text-xs text-muted-foreground">Newest delegation first. Each child runs once and is not continued.</p>
        </div>
        {visibleModelError === null ? null : <p role="alert" className="text-xs text-destructive">{visibleModelError}</p>}
        {thread === null ? (
          <p className="text-xs text-muted-foreground">Open a conversation to see its delegations.</p>
        ) : delegations.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sub agents have been called in this conversation.</p>
        ) : (
          delegations.map((delegation) => (
            <DelegationCard
              key={delegation.id}
              delegation={delegation}
              defaultModel={modelMap.get(delegation.subagentId)}
              threadId={thread.id}
            />
          ))
        )}
      </div>
    </ScrollArea>
  )
}

function DelegationCard({
  delegation,
  defaultModel,
  threadId,
}: {
  readonly delegation: ChatDelegation
  readonly defaultModel: string | undefined
  readonly threadId: string
}) {
  return (
    <section
      aria-label={`Delegation to ${delegation.subagentName}`}
      className="flex min-w-0 flex-col gap-2 rounded-md border bg-muted/20 p-2.5"
    >
      <header className="flex min-w-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium">{delegation.subagentName}</h3>
        <Badge
          variant={delegation.status === 'failed' ? 'destructive' : delegation.status === 'done' ? 'secondary' : 'default'}
          className="h-4 px-1.5 text-[10px]"
        >
          {delegation.status === 'running' ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : null}
          {delegation.status}
        </Badge>
      </header>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <span className="min-w-0 break-all" title={defaultModel}>
          Default model: {defaultModel ?? 'loading…'}
        </span>
        {delegation.worktreeBranch === null ? null : (
          <span className="flex min-w-0 items-center gap-1" title={delegation.worktreePath ?? undefined}>
            <GitBranchIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{delegation.worktreeBranch}</span>
          </span>
        )}
      </div>
      {delegation.messages.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-2 border-t border-border/60 pt-2">
          {delegation.messages.map((message) => <CompactMessage key={message.id} message={message} />)}
        </div>
      )}
      {delegation.status === 'running' ? (
        <div className="min-w-0 border-t border-border/60 pt-2 text-xs [&_pre]:text-[10px]">
          <LiveRun live={delegation.live} streaming threadId={threadId} compact />
        </div>
      ) : null}
    </section>
  )
}

/** A committed child line: small Markdown, closed reasoning, and one compact row per tool call. */
function CompactMessage({ message }: { readonly message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="min-w-0">
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          <span className="mr-1 font-medium text-foreground">User:</span>{message.text}
        </p>
        {/* The child's reminder is one more thing the model read, so the compact view shows it too. */}
        {message.reminder === undefined ? null : (
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer">Reminder</summary>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">
              {message.reminder}
            </pre>
          </details>
        )}
      </div>
    )
  }

  if (message.role !== 'assistant') {
    return (
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">{message.role === 'compaction' ? 'Context compacted' : message.role}</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono">{message.text}</pre>
      </details>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {message.errorMessage === null ? null : <p role="alert" className="text-xs text-destructive">{message.errorMessage}</p>}
      {message.blocks.map((block, index) => {
        if (block.type === 'text') {
          return (
            <div key={`text-${String(index)}`} className="min-w-0 text-xs leading-5 [&_p]:my-1 [&_pre]:my-1 [&_pre]:text-[10px]">
              <Markdown text={block.text} />
            </div>
          )
        }
        if (block.type === 'thinking') {
          return (
            <details key={`thinking-${String(index)}`} className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Thinking</summary>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">
                {block.redacted ? 'The provider did not release this reasoning.' : block.text}
              </pre>
            </details>
          )
        }

        return (
          <div key={block.callId} className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <WrenchIcon className="size-3 shrink-0" aria-hidden />
            <span className="shrink-0 text-foreground">{block.name}</span>
            <span className="truncate" title={block.arguments}>{oneLine(block.arguments)}</span>
          </div>
        )
      })}
    </div>
  )
}
