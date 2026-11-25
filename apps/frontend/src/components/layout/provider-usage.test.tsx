import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProviderUsagePanel } from './provider-usage.tsx'

const stubFetch = (body: unknown, ok = true) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok,
        status: ok ? 200 : 500,
        json: () => Promise.resolve(body),
      }),
    ),
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProviderUsagePanel', () => {
  it('lists what each provider the workspace reaches has been used for', async () => {
    stubFetch({
      usage: [
        {
          provider: 'anthropic',
          loginCount: 2,
          requests: 42,
          inputTokens: 120000,
          outputTokens: 34000,
          costUsd: 1.25,
        },
      ],
    })

    render(<ProviderUsagePanel workspaceId="workspace-1" />)

    expect(await screen.findByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText('2 logins')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('120,000 / 34,000')).toBeInTheDocument()
    expect(screen.getByText('$1.25')).toBeInTheDocument()
  })

  it('says when the workspace reaches nothing and reports a failed read', async () => {
    stubFetch({ usage: [] })
    render(<ProviderUsagePanel workspaceId="workspace-1" />)
    expect(await screen.findByText('This workspace reaches no provider yet.')).toBeInTheDocument()

    stubFetch({ error: { message: 'usage unavailable' } }, false)
    render(<ProviderUsagePanel workspaceId="workspace-2" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('usage unavailable')
  })
})
