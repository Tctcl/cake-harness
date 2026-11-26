import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatToolCall } from '../../lib/chat-api.ts'
import { ToolCallRow } from './tool-trace.tsx'

afterEach(() => vi.unstubAllGlobals())

describe('ToolCallRow', () => {
  it('fetches and shows full arguments and output only when a truncated row expands', async () => {
    const fullArguments = JSON.stringify({ path: 'a'.repeat(5000) })
    const fullResult = 'complete output '.repeat(400)
    const fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ arguments: fullArguments, result: fullResult }),
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const call: ChatToolCall = {
      id: 'call-1',
      entryId: 7,
      name: 'read',
      arguments: '{"path":"short…',
      status: 'ok',
      result: 'clipped…',
      durationMs: 12,
      truncated: true,
      fullByteLength:
        new TextEncoder().encode(fullArguments).byteLength + new TextEncoder().encode(fullResult).byteLength,
    }

    render(<ToolCallRow call={call} active={false} threadId="thread-1" />)

    expect(fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /read/ }))

    expect(await screen.findByText(/Showing the full output/)).toBeInTheDocument()
    expect(screen.getByText(fullArguments)).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === fullResult))
      .toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('labels delegate with the sub agent name and task, then expands arguments and result as usual', () => {
    const call: ChatToolCall = {
      id: 'delegate-1',
      entryId: 9,
      name: 'delegate',
      arguments: JSON.stringify({ subagentId: 'subagent-1', task: 'Review the diff', worktree: true }),
      status: 'ok',
      result: 'The diff is correct.',
      durationMs: 25,
      truncated: false,
      fullByteLength: 0,
    }

    render(
      <ToolCallRow
        call={call}
        active={false}
        threadId="thread-1"
        subagentNames={new Map([['subagent-1', 'Reviewer']])}
      />,
    )

    expect(screen.getByText('Delegated to Reviewer')).toBeInTheDocument()
    expect(screen.getByText('Review the diff')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Delegated to Reviewer/ }))
    expect(screen.getByText(call.arguments ?? '')).toBeInTheDocument()
    expect(screen.getByText('The diff is correct.')).toBeInTheDocument()
  })
})
