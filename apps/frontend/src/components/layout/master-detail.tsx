import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { useNarrowScreen } from '../../lib/use-narrow-screen.ts'
import { Button } from '../ui/button.tsx'

export interface MasterDetailItem {
  readonly id: string
  readonly name: string
  readonly detail: string
  readonly badge?: ReactNode
}

/** The reserved selection that opens an empty editor rather than an existing entry. */
export const NEW_SELECTION = 'new'

interface MasterDetailProps {
  readonly listLabel: string
  readonly newLabel: string
  readonly items: readonly MasterDetailItem[]
  readonly selection: string | null
  readonly onSelect: (selection: string | null) => void
  readonly emptyText: string
  readonly archived?: ReactNode
  readonly renderDetail: (item: MasterDetailItem | undefined) => ReactNode
}

/**
 * A catalog list beside its editor on desktop, and two full-width screens on a phone. Selection stays with the caller,
 * whose entries and editor are domain-specific; this component only supplies the shared navigation and default.
 */
export function MasterDetail({
  listLabel,
  newLabel,
  items,
  selection,
  onSelect,
  emptyText,
  archived,
  renderDetail,
}: MasterDetailProps) {
  const narrow = useNarrowScreen()
  const firstId = items[0]?.id ?? null
  const resolved = selection === null && !narrow ? firstId : selection

  useEffect(() => {
    if (narrow) {
      if (selection !== null && selection !== NEW_SELECTION && !items.some((item) => item.id === selection)) {
        onSelect(null)
      }
      return
    }

    if (selection === null || (selection !== NEW_SELECTION && !items.some((item) => item.id === selection))) {
      onSelect(firstId)
    }
  }, [firstId, items, narrow, onSelect, selection])

  const selected = items.find((item) => item.id === resolved)
  const showDetail = resolved !== null && (resolved === NEW_SELECTION || selected !== undefined)
  const list = (
    <div className="flex min-w-0 flex-col gap-2">
      <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => onSelect(NEW_SELECTION)}>
        {newLabel}
      </Button>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul aria-label={listLabel} className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={resolved === item.id}
                onClick={() => onSelect(item.id)}
                className={`flex w-full flex-col gap-1 rounded-md border p-3 text-left text-sm hover:bg-muted/50 ${
                  resolved === item.id ? 'border-foreground bg-muted/40' : ''
                }`}
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {item.name}
                  {item.badge}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{item.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {archived}
    </div>
  )

  if (narrow) {
    return showDetail ? (
      <div className="flex min-w-0 flex-col gap-3">
        <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => onSelect(null)}>
          ← Back
        </Button>
        {renderDetail(resolved === NEW_SELECTION ? undefined : selected)}
      </div>
    ) : (
      list
    )
  }

  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
      {list}
      <div className="min-w-0 md:border-l md:pl-6">
        {showDetail ? renderDetail(resolved === NEW_SELECTION ? undefined : selected) : null}
      </div>
    </div>
  )
}
