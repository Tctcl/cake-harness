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
})
