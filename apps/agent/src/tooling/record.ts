import { readFile } from 'node:fs/promises'

/** One tool reconciliation installed, as it recorded it at the time. */
export interface RecordedTool {
  readonly id: string
  /** The version the installer put on disk. */
  readonly version: string
  /** Absolute path of the installed binary. */
  readonly path: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const recordedTool = (value: unknown, where: string): RecordedTool => {
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`)
  }

  const { id, version, path } = value
  if (typeof id !== 'string' || typeof version !== 'string' || typeof path !== 'string') {
    throw new Error(`${where} must carry string id, version and path`)
  }

  return { id, version, path }
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
