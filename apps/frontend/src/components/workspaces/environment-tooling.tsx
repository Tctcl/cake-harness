import { Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { DesiredTool, ReportedEnvironmentState, ToolKind, ToolReport } from '../../lib/environment-api.ts'
import { getEnvironmentState, setEnvironmentTooling } from '../../lib/environment-api.ts'
import { Badge } from '../ui/badge.tsx'
import { Button } from '../ui/button.tsx'
import { Input } from '../ui/input.tsx'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'the tooling could not be saved'

const sameTools = (left: readonly DesiredTool[], right: readonly DesiredTool[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const reportFor = (reports: readonly ToolReport[], tool: DesiredTool): ToolReport | undefined =>
  reports.find((report) => report.id === `${tool.kind}:${tool.name}`)

function ReportedStatus({ report }: { report: ToolReport | undefined }) {
  if (report === undefined) return <span className="text-xs text-muted-foreground">Not reported</span>
  const status = report.status ?? 'installed'

  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={status === 'failed' ? 'destructive' : status === 'missing' ? 'secondary' : 'outline'}>
        {status}
      </Badge>
      {report.error === undefined ? null : <span className="max-w-md text-xs break-words text-destructive">{report.error}</span>}
    </div>
  )
}

export function EnvironmentTooling({
  environmentId,
  tools,
  restarting,
  onRestart,
}: {
  environmentId: string
  tools: readonly DesiredTool[]
  restarting: boolean
  onRestart: () => Promise<void>
}) {
  const [draft, setDraft] = useState<DesiredTool[]>([...tools])
  const [saved, setSaved] = useState<DesiredTool[]>([...tools])
  const [kind, setKind] = useState<ToolKind>('apt')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('latest')
  const [reported, setReported] = useState<ReportedEnvironmentState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getEnvironmentState(environmentId).then(
      (state) => {
        if (!cancelled) setReported(state)
      },
      (failure: unknown) => {
        if (!cancelled) setError(messageOf(failure))
      },
    )

    return () => {
      cancelled = true
    }
  }, [environmentId, restarting])

  const add = (): void => {
    const trimmed = name.trim()
    if (trimmed === '' || version.trim() === '') return
    setDraft((current) => [
      ...current.filter((tool) => !(tool.kind === kind && tool.name === trimmed)),
      { kind, name: trimmed, version: version.trim() },
    ])
    setName('')
    setVersion('latest')
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const saved = await setEnvironmentTooling(environmentId, draft)
      setDraft([...saved.tooling])
      setSaved([...saved.tooling])
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const restart = async (): Promise<void> => {
    setError(null)
    try {
      await onRestart()
      setReported(await getEnvironmentState(environmentId))
    } catch (failure) {
      setError(messageOf(failure))
    }
  }

  const reports = reported?.state?.tools ?? []
  const reportedAt = reported?.reportedAt

  return (
    <section aria-label="Tooling" className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">Tooling</h2>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={restarting} onClick={() => void restart()}>
            {restarting ? 'Restarting…' : 'Restart'}
          </Button>
          <Button type="button" size="sm" disabled={busy || sameTools(draft, saved)} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Apt packages are reinstalled on every boot; npm packages persist in /home/dev/.local. Changes apply on next start. Removing a package stops managing it but does not uninstall it.
      </p>

      {draft.length === 0 ? (
        <p className="text-muted-foreground">No additional packages selected.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr><th className="py-2 pr-3 font-medium">Package</th><th className="py-2 pr-3 font-medium">Kind</th><th className="py-2 pr-3 font-medium">Version</th><th className="py-2 pr-3 font-medium">Last reported</th><th className="py-2"><span className="sr-only">Remove</span></th></tr>
            </thead>
            <tbody>
              {draft.map((tool) => (
                <tr key={`${tool.kind}:${tool.name}`} className="border-t">
                  <td className="py-2 pr-3 font-mono">{tool.name}</td>
                  <td className="py-2 pr-3">{tool.kind}</td>
                  <td className="py-2 pr-3 font-mono">{tool.version}</td>
                  <td className="py-2 pr-3"><ReportedStatus report={reportFor(reports, tool)} /></td>
                  <td className="py-2 text-right">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${tool.kind} ${tool.name}`}
                      onClick={() => setDraft((current) => current.filter((candidate) => candidate !== tool))}
                    >
                      <Trash2Icon className="size-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label htmlFor="tool-kind" className="flex flex-col gap-1 text-xs">Kind
          <select id="tool-kind" aria-label="Tool kind" className="h-9 rounded-md border bg-transparent px-2" value={kind} onChange={(event) => setKind(event.target.value === 'npm' ? 'npm' : 'apt')}>
            <option value="apt">apt</option><option value="npm">npm</option>
          </select>
        </label>
        <label htmlFor="tool-package" className="flex min-w-40 flex-1 flex-col gap-1 text-xs">Package
          <Input id="tool-package" aria-label="Tool package" value={name} placeholder={kind === 'apt' ? 'shellcheck' : 'typescript'} onChange={(event) => setName(event.target.value)} />
        </label>
        <label htmlFor="tool-version" className="flex w-32 flex-col gap-1 text-xs">Version
          <Input id="tool-version" aria-label="Tool version" value={version} onChange={(event) => setVersion(event.target.value)} />
        </label>
        <Button type="button" size="sm" variant="outline" disabled={name.trim() === '' || version.trim() === ''} onClick={add}>Add</Button>
      </div>
      {reportedAt === null || reportedAt === undefined ? null : <span className="text-xs text-muted-foreground">Reported {new Date(reportedAt).toLocaleString()}</span>}
      {error === null ? null : <p role="alert" className="text-destructive">{error}</p>}
    </section>
  )
}
