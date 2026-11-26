import { homedir } from 'node:os'

import { readBootstrapConfig } from './config.js'
import { applyCredentials } from './credentials/apply.js'
import { fetchDocuments } from './documents.js'
import { log } from './log.js'
import { reportState } from './report.js'
import type { InstalledTool, ToolingState } from './tooling/contract.js'
import { DETECTORS, detectInstalled } from './tooling/detect.js'
import { installPackages } from './tooling/install.js'
import { planReconcile } from './tooling/plan.js'
import { readInstallRecord, writeInstallRecord } from './tooling/record.js'

const main = async (): Promise<void> => {
  const config = readBootstrapConfig(process.env)
  log.info('bootstrap.start', { manifestUrl: config.manifestUrl })

  const documents = await fetchDocuments(config.manifestUrl, config.token)
  log.info('documents.loaded', {
    tools: documents.tooling.tools.map((tool) => tool.id),
    credentials: documents.credentials.credentials.map((credential) => credential.id),
  })

  const record = await readInstallRecord(config.installRecordPath)
  const detectable = documents.tooling.tools.filter((tool) => DETECTORS[tool.id] !== undefined)
  const packages = documents.tooling.tools.filter((tool) => tool.kind !== undefined)
  const undetectable = documents.tooling.tools.filter((tool) => DETECTORS[tool.id] === undefined && tool.kind === undefined)
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

  const outcome = await installPackages(packages, record, {
    onResult: (tool, result) => {
      if (result.status === 'failed') {
        log.error('tooling.install_failed', { id: tool.id, message: result.error ?? 'unknown install failure' })
      } else {
        log.info('tooling.installed', { id: tool.id, version: result.version, path: result.path })
      }
    },
  })
  if (packages.length > 0) {
    try {
      await writeInstallRecord(config.installRecordPath, outcome.record)
    } catch (error) {
      // A record improves provenance on the next boot; losing it must not take SSH down after packages installed.
      log.warn('tooling.record_failed', { message: error instanceof Error ? error.message : String(error) })
    }
  }

  const installedIds = new Set(actual.tools.map((tool) => tool.id))
  const missing: InstalledTool[] = detectable.filter((tool) => !installedIds.has(tool.id)).map((tool) => ({
    ...tool,
    path: null,
    source: 'image',
    status: 'missing',
  }))
  const reported: ToolingState = { ...actual, tools: [...actual.tools, ...missing, ...outcome.results] }
  log.info('tooling.reconciled', {
    tools: reported.tools.map((tool) => `${tool.id}@${tool.version} (${tool.status ?? 'installed'})`),
  })

  const applied = applyCredentials(documents.credentials, homedir())
  log.info('credentials.applied', { ids: applied.ids, envFile: applied.envFile, files: applied.files })

  if (config.stateUrl === null) {
    log.info('state.unreported', { reason: 'DEV_ENV_STATE_URL is not set' })
  } else {
    const report = await reportState(config.stateUrl, reported, config.token)
    if (report.delivered) {
      log.info('state.reported', { url: config.stateUrl })
    } else {
      log.warn('state.report_failed', { url: config.stateUrl, status: report.status })
    }
  }

  log.info('bootstrap.done', { changed: outcome.results.filter((tool) => tool.status === 'installed').length })
}

void main().catch((error: unknown) => {
  log.error('bootstrap.failed', { message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
