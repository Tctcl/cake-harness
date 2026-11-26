import type { DesiredTool, ToolingConfig } from './contract.js'

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
  const base = {
    id: requireString(record['id'], `${where}.id`),
    version: requireString(record['version'], `${where}.version`),
  }
  if (record['kind'] === undefined && record['name'] === undefined) return base
  if (record['kind'] !== 'apt' && record['kind'] !== 'npm') {
    throw new Error(`${where}.kind must be apt or npm`)
  }

  return { ...base, kind: record['kind'], name: requireString(record['name'], `${where}.name`) }
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
