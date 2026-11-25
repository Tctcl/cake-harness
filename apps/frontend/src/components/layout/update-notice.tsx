import { ArrowUpCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { UpdateStatus } from '../../lib/update-api.ts'
import { getUpdateStatus } from '../../lib/update-api.ts'

/**
 * A release newer than this install, above the account at the foot of the sidebar. Nothing renders when there is
 * nothing to say: an install that is current, a checkout comparing nothing, or a failed fetch — the check is a
 * convenience, and the shell must not depend on it.
 */
export function UpdateNotice() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    let active = true

    getUpdateStatus().then(
      (answer) => {
        if (active) setStatus(answer)
      },
      () => {
        // A failed read leaves the notice out; the backend retries on its own interval.
      },
    )

    return () => {
      active = false
    }
  }, [])

  if (status?.available !== true || status.latest === null) return null

  return (
    <a
      href={status.url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      title={`This install runs ${status.current ?? 'an unknown version'}`}
    >
      <ArrowUpCircleIcon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Update to {status.latest}</span>
    </a>
  )
}
