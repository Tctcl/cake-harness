import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MasterDetail, NEW_SELECTION } from './master-detail.tsx'

const items = [
  { id: 'first', name: 'First entry', detail: 'The first detail' },
  { id: 'second', name: 'Second entry', detail: 'The second detail' },
]

function Harness() {
  const [selection, setSelection] = useState<string | null>(null)
  return (
    <MasterDetail
      listLabel="Examples"
      newLabel="New example"
      items={items}
      selection={selection}
      onSelect={setSelection}
      emptyText="No examples"
      renderDetail={(item) => <p>{selection === NEW_SELECTION ? 'Empty editor' : `Editing ${item?.name ?? ''}`}</p>}
    />
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('MasterDetail', () => {
  it('selects the first entry by default and switches editors', async () => {
    render(<Harness />)

    expect(await screen.findByText('Editing First entry')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Second entry/ }))
    expect(screen.getByText('Editing Second entry')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New example' }))
    expect(screen.getByText('Empty editor')).toBeInTheDocument()
  })

  it('starts on the list on a narrow screen and returns with Back', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    render(<Harness />)

    expect(await screen.findByRole('button', { name: /First entry/ })).toBeInTheDocument()
    expect(screen.queryByText('Editing First entry')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /First entry/ }))
    expect(screen.getByText('Editing First entry')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '← Back' }))
    expect(screen.queryByText('Editing First entry')).toBeNull()
    expect(screen.getByRole('list', { name: 'Examples' })).toBeInTheDocument()
  })
})
