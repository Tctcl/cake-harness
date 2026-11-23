import type { DesiredTool, InstalledTool, ToolingConfig, ToolingState } from './contract.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireRecord = (value: unknown, where: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`)
  }
  return value
}

const requireString = (value: unknown, where: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where} must be a non-empty string`)
  }
  return value
}

const requireArray = (value: unknown, where: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${where} must be an array`)
  }
  return value
}

const requireSchemaVersion = (value: unknown, where: string): 1 => {
  if (value !== 1) {
    throw new Error(`${where}.schemaVersion must be 1, got ${JSON.stringify(value)}`)
  }
  return 1
}

const parseDesiredTool = (value: unknown, where: string): DesiredTool => {
  const record = requireRecord(value, where)
  return {
    id: requireString(record['id'], `${where}.id`),
    version: requireString(record['version'], `${where}.version`),
  }
}

/**
 * Validates the document the backend serves. Parsing at the edge means no
 * downstream code has to defend against a half-written config.
 */
export const parseDesiredTooling = (value: unknown): ToolingConfig => {
  const record = requireRecord(value, 'tooling config')
  return {
    schemaVersion: requireSchemaVersion(record['schemaVersion'], 'tooling config'),
    tools: requireArray(record['tools'], 'tooling config.tools').map((tool, index) =>
      parseDesiredTool(tool, `tooling config.tools[${index}]`),
    ),
  }
}

const parseInstalledTool = (value: unknown, where: string): InstalledTool => {
  const record = requireRecord(value, where)
  const desired = parseDesiredTool(record, where)
  const path = record['path']
  if (path !== null && typeof path !== 'string') {
    throw new Error(`${where}.path must be a string or null`)
  }
  const source = record['source']
  if (source !== 'image' && source !== 'installed') {
    throw new Error(`${where}.source must be "image" or "installed", got ${JSON.stringify(source)}`)
  }
  return { ...desired, path, source }
}

export const parseToolingState = (value: unknown): ToolingState => {
  const record = requireRecord(value, 'tooling state')
  return {
    schemaVersion: requireSchemaVersion(record['schemaVersion'], 'tooling state'),
    reportedAt: requireString(record['reportedAt'], 'tooling state.reportedAt'),
    tools: requireArray(record['tools'], 'tooling state.tools').map((tool, index) =>
      parseInstalledTool(tool, `tooling state.tools[${index}]`),
    ),
  }
}
