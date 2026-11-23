import { homedir } from 'node:os'
import { join } from 'node:path'

import { loadJsonDocument, readBootstrapConfig } from './config.js'
import { applyCredentials } from './credentials/apply.js'
import { parseCredentialDocument } from './credentials/parse.js'
import { log } from './log.js'
import { DETECTORS, detectInstalled } from './tooling/detect.js'
import type { ToolingState } from './tooling/contract.js'
import { parseDesiredTooling } from './tooling/parse.js'
import { planReconcile } from './tooling/plan.js'

const desiredToolingPath = (configDir: string): string => join(configDir, 'desired-tooling.json')
const credentialPath = (configDir: string): string => join(configDir, 'credentials.json')

const main = (): void => {
  const config = readBootstrapConfig(process.env)
  log.info('bootstrap.start', { configDir: config.configDir })

  const desired = loadJsonDocument(desiredToolingPath(config.configDir), parseDesiredTooling)
  const credentials = loadJsonDocument(credentialPath(config.configDir), parseCredentialDocument)

  const detectable = desired.tools.filter((tool) => DETECTORS[tool.id] !== undefined).map((tool) => tool.id)
  const undetectable = desired.tools.filter((tool) => DETECTORS[tool.id] === undefined).map((tool) => tool.id)
  if (undetectable.length > 0) {
    log.warn('tooling.undetectable', { ids: undetectable })
  }

  const actual: ToolingState = {
    schemaVersion: 1,
    reportedAt: new Date().toISOString(),
    tools: detectInstalled(detectable),
  }
  log.info('tooling.actual', {
    reportedAt: actual.reportedAt,
    tools: actual.tools.map((tool) => `${tool.id}@${tool.version} (${tool.source})`),
  })

  const plan = planReconcile(desired, actual)
  log.info('tooling.plan', {
    install: plan.install.map((tool) => `${tool.id}@${tool.version}`),
    replace: plan.replace.map((entry) => `${entry.desired.id}:${entry.installed.version}->${entry.desired.version}`),
    keep: plan.keep.map((tool) => `${tool.id}@${tool.version}`),
    extra: plan.extra.map((tool) => `${tool.id}@${tool.version}`),
  })

  const applied = applyCredentials(credentials, homedir())
  log.info('credentials.applied', { ids: applied.ids, envFile: applied.envFile, files: applied.files })

  log.info('bootstrap.done', { changed: plan.install.length + plan.replace.length })
}

try {
  main()
} catch (error) {
  log.error('bootstrap.failed', { message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
}
