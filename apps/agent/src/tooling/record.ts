import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** One tool reconciliation installed, as it recorded it at the time. */
export interface RecordedTool {
  readonly id: string
  /** The version the installer put on disk. */
  readonly version: string
  /** Absolute path of the installed binary, or null when a package manager has no single binary path. */
  readonly path: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const recordedTool = (value: unknown, where: string): RecordedTool => {
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`)
  }

  const { id, version, path } = value
  if (typeof id !== 'string' || typeof version !== 'string' || (typeof path !== 'string' && path !== null)) {
    throw new Error(`${where} must carry string id, version and path (path may be null)`)
  }

  return { id, version, path }
}

/** Persist successful installs atomically so a reboot never mistakes them for image tools. */
export const writeInstallRecord = async (
  path: string,
  record: ReadonlyMap<string, RecordedTool>,
): Promise<void> => {
  const tools = [...record.values()].sort((a, b) => a.id.localeCompare(b.id))
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, tools }, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * Reads what reconciliation installed. A fresh container has no record at all,
 * which is not an error: it means every tool found so far came from the image.
 * A record that exists but cannot be read is an error — that is a bug, and
 * silently calling its tools "from the image" would hide it.
 */
export const readInstallRecord = async (path: string): Promise<ReadonlyMap<string, RecordedTool>> => {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isRecord(error) && error['code'] === 'ENOENT') {
      return new Map()
    }

    throw new Error(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || !Array.isArray(parsed['tools'])) {
    throw new Error(`${path} is not an install record: expected { schemaVersion: 1, tools: [] }`)
  }

  const tools = parsed['tools'].map((tool, index) => recordedTool(tool, `${path}: tools[${index}]`))

  return new Map(tools.map((tool) => [tool.id, tool]))
}
