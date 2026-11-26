import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readInstallRecord, writeInstallRecord } from './record.js'

let scratch = ''

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'dev-env-record-'))
})

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true })
})

const writeRecord = async (name: string, body: string): Promise<string> => {
  const path = join(scratch, name)
  await writeFile(path, body, 'utf8')

  return path
}

describe('writeInstallRecord', () => {
  it('persists successful package provenance on the home-volume path', async () => {
    const path = join(scratch, 'nested', 'installed.json')
    await writeInstallRecord(path, new Map([
      ['apt:jq', { id: 'apt:jq', version: 'latest', path: null }],
      ['npm:cowsay', { id: 'npm:cowsay', version: '1.6.0', path: '/home/dev/.local/lib/node_modules/cowsay' }],
    ]))

    await expect(readInstallRecord(path)).resolves.toEqual(new Map([
      ['apt:jq', { id: 'apt:jq', version: 'latest', path: null }],
      ['npm:cowsay', { id: 'npm:cowsay', version: '1.6.0', path: '/home/dev/.local/lib/node_modules/cowsay' }],
    ]))
  })
})

describe('readInstallRecord', () => {
  it('treats a container with no record as one where nothing was installed', async () => {
    await expect(readInstallRecord(join(scratch, 'missing.json'))).resolves.toEqual(new Map())
  })

  it('keys what reconciliation installed by tool id', async () => {
    const path = await writeRecord(
      'installed.json',
      JSON.stringify({
        schemaVersion: 1,
        tools: [{ id: 'go', version: '1.25.3', path: '/usr/local/go/bin/go' }],
      }),
    )

    const record = await readInstallRecord(path)

    expect(record.get('go')).toEqual({ id: 'go', version: '1.25.3', path: '/usr/local/go/bin/go' })
    expect(record.get('node')).toBeUndefined()
  })

  it('refuses a record it cannot read, rather than calling its tools image tools', async () => {
    const path = await writeRecord('broken.json', '{"schemaVersion":1,"tools":[{"id":"go"}]}')

    await expect(readInstallRecord(path)).rejects.toThrow(/must carry string id, version and path/)
  })

  it('refuses a file that is not a record at all', async () => {
    const path = await writeRecord('other.json', '{"tools":[]}')

    await expect(readInstallRecord(path)).rejects.toThrow(/expected \{ schemaVersion: 1, tools: \[\] \}/)
  })
})
