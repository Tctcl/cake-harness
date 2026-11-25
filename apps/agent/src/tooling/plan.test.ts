import { describe, expect, it } from 'vitest'

import type { ToolingConfig, ToolingState } from './contract.js'
import { planReconcile } from './plan.js'

const desired: ToolingConfig = {
  schemaVersion: 1,
  tools: [
    { id: 'node', version: '26.13.1' },
    { id: 'python', version: '3.13.4' },
    { id: 'go', version: '1.25.3' },
  ],
}

const actual: ToolingState = {
  schemaVersion: 1,
  reportedAt: '2026-11-23T12:00:00.000Z',
  tools: [
    { id: 'node', version: '26.13.1', path: '/usr/local/bin/node', source: 'image' },
    { id: 'python', version: '3.12.9', path: '/usr/bin/python3', source: 'image' },
    { id: 'ruby', version: '3.4.5', path: '/usr/bin/ruby', source: 'image' },
  ],
}

describe('planReconcile', () => {
  it('separates keep, replace, install and extra', () => {
    const plan = planReconcile(desired, actual)

    expect(plan.keep).toEqual([{ id: 'node', version: '26.13.1' }])
    expect(plan.replace).toEqual([
      { desired: { id: 'python', version: '3.13.4' }, installed: actual.tools[1] },
    ])
    expect(plan.install).toEqual([{ id: 'go', version: '1.25.3' }])
    expect(plan.extra).toEqual([{ id: 'ruby', version: '3.4.5', path: '/usr/bin/ruby', source: 'image' }])
  })

  it('plans an install for everything when nothing is installed', () => {
    const plan = planReconcile(desired, { schemaVersion: 1, reportedAt: actual.reportedAt, tools: [] })

    expect(plan.install).toEqual(desired.tools)
    expect(plan.keep).toEqual([])
    expect(plan.replace).toEqual([])
    expect(plan.extra).toEqual([])
  })

  it('plans no work when actual already matches desired', () => {
    const plan = planReconcile(desired, { schemaVersion: 1, reportedAt: actual.reportedAt, tools: desired.tools.map((tool) => ({ ...tool, path: null, source: 'installed' as const })) })

    expect(plan.install).toEqual([])
    expect(plan.replace).toEqual([])
    expect(plan.keep).toEqual(desired.tools)
    expect(plan.extra).toEqual([])
  })

  it('names an undesired tool as extra rather than planning a removal', () => {
    const plan = planReconcile({ schemaVersion: 1, tools: [] }, actual)

    expect(plan.extra).toHaveLength(3)
    expect(plan).not.toHaveProperty('remove')
  })

  it('does not treat a matching id at another version as satisfied', () => {
    const plan = planReconcile(desired, {
      schemaVersion: 1,
      reportedAt: actual.reportedAt,
      tools: [{ id: 'node', version: '22.21.1', path: null, source: 'image' }],
    })

    expect(plan.keep).toEqual([])
    expect(plan.replace.map((entry) => entry.desired.id)).toEqual(['node'])
  })
})
