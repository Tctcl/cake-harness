import { homedir } from 'node:os'

import { readBootstrapConfig } from './config.js'
import { applyCredentials } from './credentials/apply.js'
import { fetchDocuments } from './documents.js'
import { log } from './log.js'
import { reportState } from './report.js'
import type { ToolingState } from './tooling/contract.js'
import { DETECTORS, detectInstalled } from './tooling/detect.js'
import { planReconcile } from './tooling/plan.js'
import { readInstallRecord } from './tooling/record.js'

const main = async (): Promise<void> => {
  const config = readBootstrapConfig(process.env)
  log.info('bootstrap.start', { manifestUrl: config.manifestUrl })

  const documents = await fetchDocuments(config.manifestUrl)
  log.info('documents.loaded', {
    tools: documents.tooling.tools.map((tool) => tool.id),
    credentials: documents.credentials.credentials.map((credential) => credential.id),
  })

  const record = await readInstallRecord(config.installRecordPath)
  const detectable = documents.tooling.tools.filter((tool) => DETECTORS[tool.id] !== undefined)
  const undetectable = documents.tooling.tools.filter((tool) => DETECTORS[tool.id] === undefined)
  if (undetectable.length > 0) {
    log.warn('tooling.undetectable', { ids: undetectable.map((tool) => tool.id) })
  }

  const actual: ToolingState = {
    schemaVersion: 1,
    reportedAt: new Date().toISOString(),
    tools: detectInstalled(
      detectable.map((tool) => tool.id),
      record,
    ),
  }
  log.info('tooling.actual', {
    reportedAt: actual.reportedAt,
    tools: actual.tools.map((tool) => `${tool.id}@${tool.version} (${tool.source})`),
  })

  const plan = planReconcile(documents.tooling, actual)
  log.info('tooling.plan', {
    install: plan.install.map((tool) => `${tool.id}@${tool.version}`),
    replace: plan.replace.map((entry) => `${entry.desired.id}:${entry.installed.version}->${entry.desired.version}`),
    keep: plan.keep.map((tool) => `${tool.id}@${tool.version}`),
    extra: plan.extra.map((tool) => `${tool.id}@${tool.version}`),
  })

  const applied = applyCredentials(documents.credentials, homedir())
  log.info('credentials.applied', { ids: applied.ids, envFile: applied.envFile, files: applied.files })

  if (config.stateUrl === null) {
    log.info('state.unreported', { reason: 'DEV_ENV_STATE_URL is not set' })
  } else {
    const report = await reportState(config.stateUrl, actual)
    if (report.delivered) {
      log.info('state.reported', { url: config.stateUrl })
    } else {
      log.warn('state.report_failed', { url: config.stateUrl, status: report.status })
    }
  }

  log.info('bootstrap.done', { changed: plan.install.length + plan.replace.length })
}

void main().catch((error: unknown) => {
  log.error('bootstrap.failed', { message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
