import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const docsDirectory = fileURLToPath(new URL('./content/docs', import.meta.url))

const markdownFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return ['.md', '.mdx'].includes(extname(entry.name)) ? [path] : []
  })

const frontmatter = (source: string, path: string): string => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  expect(match, `${path} must start with a frontmatter block`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('documentation pages', () => {
  const pages = markdownFiles(docsDirectory)

  it('finds the documentation collection', () => {
    expect(pages.length).toBeGreaterThan(0)
  })

  it.each(pages)('gives %s a non-empty title', (path) => {
    const metadata = frontmatter(readFileSync(path, 'utf8'), path)
    const title = /^title:\s*(.+?)\s*$/m.exec(metadata)?.[1]

    expect(title, `${path} must have a title`).toBeDefined()
    expect(title?.replaceAll(/['"]/g, '').trim().length).toBeGreaterThan(0)
  })
})
