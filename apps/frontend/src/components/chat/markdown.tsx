import type { ComponentProps } from 'react'
import { Streamdown } from 'streamdown'

import { CodeBlock } from '../ui/code-block.tsx'

/**
 * Streamdown parses and highlights a reply as it streams; the code fences are wrapped in the Code Block surface so a
 * reply's chrome matches the rest of the app without a second markdown pipeline.
 */
const components = {
  pre: ({ node: _node, children, ...props }: ComponentProps<'pre'> & { node?: unknown }) => (
    <CodeBlock>
      <pre {...props}>{children}</pre>
    </CodeBlock>
  ),
}

export function Markdown({ text }: { text: string }) {
  return <Streamdown components={components}>{text}</Streamdown>
}
