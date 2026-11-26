import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatDelegation, ChatLive, ChatMessage, ChatThread, WorkspaceSummary } from '../../lib/chat-api.ts'
import { openThread, resetThreads, STREAM_EVENT } from '../../lib/chat-store.ts'
import { Topbar } from '../layout/topbar.tsx'
import { TooltipProvider } from '../ui/tooltip.tsx'
import { DelegationsPanel } from './delegations-panel.tsx'

class FakeStream {
  static readonly opened: FakeStream[] = []
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()

  constructor(_url: string) {
    FakeStream.opened.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  close(): void {}

  emit(data: unknown): void {
    for (const listener of this.listeners.get(STREAM_EVENT) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent<string>)
    }
  }
}

const workspace: WorkspaceSummary = {
  id: 'workspace-1',
  name: 'Platform',
  description: '',
  isDefault: false,
  allowAll: true,
  position: 0,
}

const thread: ChatThread = {
  id: 'thread-1',
  title: 'Parent',
  workspaceId: workspace.id,
  agentId: 'agent-1',
  overrides: { credentialId: null, modelId: null, thinkingLevel: null },
}

const NO_LIVE: ChatLive = { blocks: [], tools: [], turns: 0, compacting: 0, failure: null }
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 }

const message = (id: number, text: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role: 'assistant',
  text,
  blocks: [{ type: 'text', text }],
  stopReason: 'stop',
  errorMessage: null,
  reason: null,
  ...overrides,
})

const delegation = (id: string, name: string, status: ChatDelegation['status']): ChatDelegation => ({
  id,
  subagentId: `subagent-${id}`,
  subagentName: name,
  status,
  worktreePath: null,
  worktreeBranch: null,
  live: NO_LIVE,
  messages: [],
})

const frame = (delegations: readonly ChatDelegation[]) => ({
  messages: [],
  tools: [],
  run: null,
  usage: NO_USAGE,
  live: NO_LIVE,
  delegations,
})

const subagent = (id: string, modelId: string) => ({
  id,
  workspaceId: workspace.id,
  name: id,
  description: '',
  allowAll: true,
  systemPromptAppend: '',
  instructions: '',
  credentialId: null,
  modelId,
  thinkingLevel: 'low',
  allowedModels: [modelId],
  callableBy: [],
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeStream)
  FakeStream.opened.length = 0
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let result: unknown = {}
    if (url.startsWith('/threads/thread-1/messages')) result = { messages: [], nextCursor: null }
    else if (url === '/workspaces/workspace-1/subagents?archived=true') {
      result = { subagents: [subagent('subagent-failed', 'model-3')] }
    } else if (url === '/workspaces/workspace-1/subagents') {
      result = { subagents: [subagent('subagent-running', 'model-1'), subagent('subagent-done', 'model-2')] }
    }

    return Promise.resolve({ ok: true, json: () => Promise.resolve(result) })
  }))
})

afterEach(() => {
  resetThreads()
  vi.unstubAllGlobals()
})

describe('DelegationsPanel', () => {
  it('renders running live activity, committed done and failed messages, models and worktrees newest first', async () => {
    openThread(thread.id)
    render(<DelegationsPanel thread={thread} workspace={workspace} />)
    await waitFor(() => expect(FakeStream.opened[0]).toBeDefined())

    const running = delegation('running', 'Runner', 'running')
    const done = {
      ...delegation('done', 'Reviewer', 'done'),
      worktreePath: '/home/dev/workspace/.cake/worktrees/done',
      worktreeBranch: 'cake/done',
      messages: [message(2, '**Finished result**', {
        blocks: [
          { type: 'thinking' as const, text: 'committed child reasoning', redacted: false },
          { type: 'toolCall' as const, callId: 'read-1', name: 'read', arguments: '{"path":"README.md"}' },
          { type: 'text' as const, text: '**Finished result**' },
        ],
      })],
    }
    const failed = {
      ...delegation('failed', 'Failing worker', 'failed'),
      messages: [message(3, 'partial child answer', { stopReason: 'error', errorMessage: 'child provider failed' })],
    }
    const live: ChatLive = {
      blocks: [
        { type: 'thinking', text: 'live child reasoning', redacted: false },
        { type: 'text', text: 'live child answer' },
        { type: 'toolCall', callId: 'grep-1', name: 'grep', arguments: '{"pattern":"cake"}' },
      ],
      tools: [{
        id: 'grep-1',
        name: 'grep',
        status: 'running',
        output: 'partial grep output',
        droppedBytes: 0,
        droppedLines: 0,
        diagnostics: [],
        question: null,
      }],
      turns: 1,
      compacting: 0,
      failure: null,
    }
    FakeStream.opened[0]?.emit(frame([done, { ...running, live }, failed]))

    const cards = await screen.findAllByRole('region', { name: /^Delegation to/ })
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
      'Delegation to Failing worker',
      'Delegation to Runner',
      'Delegation to Reviewer',
    ])
    const runningCard = screen.getByRole('region', { name: 'Delegation to Runner' })
    expect(within(runningCard).getByText('running', { selector: '[data-slot="badge"]' })).toBeInTheDocument()
    expect(within(runningCard).getByText('live child answer')).toBeInTheDocument()
    expect(within(runningCard).getByRole('button', { name: 'Thought for a few seconds' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(runningCard).getByText('partial grep output')).toBeInTheDocument()
    expect(await within(runningCard).findByText(/Default model: model-1/)).toBeInTheDocument()

    const doneCard = screen.getByRole('region', { name: 'Delegation to Reviewer' })
    expect(within(doneCard).getByText('Finished result')).toBeInTheDocument()
    expect(within(doneCard).getByText('Thinking')).toBeInTheDocument()
    expect(within(doneCard).getByText('read')).toBeInTheDocument()
    expect(within(doneCard).getByText('cake/done')).toBeInTheDocument()
    expect(await within(doneCard).findByText(/Default model: model-2/)).toBeInTheDocument()

    const failedCard = screen.getByRole('region', { name: 'Delegation to Failing worker' })
    expect(within(failedCard).getByText('failed')).toBeInTheDocument()
    expect(within(failedCard).getByRole('alert')).toHaveTextContent('child provider failed')
    expect(await within(failedCard).findByText(/Default model: model-3/)).toBeInTheDocument()
  })

  it('counts running delegations on the closed panel button and hides the count when open', async () => {
    openThread(thread.id)
    const { rerender } = render(
      <TooltipProvider>
        <Topbar thread={thread} panel={null} onToggle={() => {}} onRenamed={() => {}} />
      </TooltipProvider>,
    )
    await waitFor(() => expect(FakeStream.opened[0]).toBeDefined())
    FakeStream.opened[0]?.emit(frame([
      delegation('running', 'Runner', 'running'),
      delegation('done', 'Reviewer', 'done'),
      delegation('failed', 'Other runner', 'running'),
    ]))

    const button = screen.getByRole('button', { name: 'Sub agents' })
    expect(await within(button).findByText('2')).toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <Topbar thread={thread} panel="subagents" onToggle={() => {}} onRenamed={() => {}} />
      </TooltipProvider>,
    )
    expect(within(button).queryByText('2')).toBeNull()
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})
