import { describe, expect, it } from 'vitest'

import type { DesiredTool } from './contract.js'
import { installPackages } from './install.js'
import type { CommandResult } from './install.js'

const ok = (stdout = ''): CommandResult => ({ stdout, stderr: '' })
describe('installPackages', () => {
  it('refreshes apt once and installs all apt packages in one batch every boot', async () => {
    const calls: { command: string; args: readonly string[] }[] = []
    const tools: DesiredTool[] = [
      { id: 'apt:curl', kind: 'apt', name: 'curl', version: 'latest' },
      { id: 'apt:jq', kind: 'apt', name: 'jq', version: '1.6-2.1' },
    ]
    const previous = new Map([['apt:curl', { id: 'apt:curl', version: 'old', path: null }]])

    const outcome = await installPackages(tools, previous, {
      run: async (command, args) => {
        calls.push({ command, args })
        return ok()
      },
    })

    expect(calls).toEqual([
      { command: 'sudo', args: ['apt-get', 'update'] },
      { command: 'sudo', args: ['apt-get', 'install', '-y', 'curl', 'jq=1.6-2.1'] },
    ])
    expect(outcome.results.map((tool) => tool.status)).toEqual(['installed', 'installed'])
    expect(outcome.record.get('apt:curl')?.version).toBe('latest')
  })

  it('skips an npm package that is already globally installed and reports its actual version', async () => {
    const calls: string[][] = []
    const outcome = await installPackages(
      [{ id: 'npm:cowsay', kind: 'npm', name: 'cowsay', version: '1.6.0' }],
      new Map(),
      {
        run: async (command, args) => {
          calls.push([command, ...args])
          return ok(JSON.stringify({ dependencies: { cowsay: { version: '1.5.0' } } }))
        },
      },
    )

    expect(calls).toEqual([['npm', 'ls', '--global', '--depth=0', '--json', 'cowsay']])
    expect(outcome.results[0]).toMatchObject({ status: 'installed', version: '1.5.0' })
  })

  it('reports one npm failure and continues installing the next package', async () => {
    const installed: string[] = []
    const tools: DesiredTool[] = [
      { id: 'npm:bad', kind: 'npm', name: 'bad', version: '1.0.0' },
      { id: 'npm:good', kind: 'npm', name: 'good', version: '2.0.0' },
    ]
    const outcome = await installPackages(tools, new Map(), {
      run: async (_command, args) => {
        if (args[0] === 'ls') throw new Error('missing')
        const spec = args.at(-1)
        if (spec === 'bad@1.0.0') throw new Error('registry refused bad')
        installed.push(spec ?? '')
        return ok()
      },
    })

    expect(installed).toEqual(['good@2.0.0'])
    expect(outcome.results[0]).toMatchObject({ status: 'failed', error: 'registry refused bad' })
    expect(outcome.results[1]).toMatchObject({ status: 'installed', id: 'npm:good' })
    expect(outcome.record.has('npm:bad')).toBe(false)
    expect(outcome.record.has('npm:good')).toBe(true)
  })

  it('continues with npm after an apt batch fails', async () => {
    const tools: DesiredTool[] = [
      { id: 'apt:bad', kind: 'apt', name: 'bad', version: 'latest' },
      { id: 'npm:good', kind: 'npm', name: 'good', version: 'latest' },
    ]
    const outcome = await installPackages(tools, new Map(), {
      run: async (_command, args) => {
        if (args[0] === 'apt-get') throw new Error('apt is unavailable')
        if (args[0] === 'ls') throw new Error('missing')
        return ok()
      },
    })

    expect(outcome.results).toHaveLength(2)
    expect(outcome.results[0]?.status).toBe('failed')
    expect(outcome.results[1]?.status).toBe('installed')
  })
})
