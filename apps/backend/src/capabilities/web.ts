import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { defineExtension, defineTool } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'

const DEFAULT_MAX_BYTES = 200 * 1024
const HARD_MAX_BYTES = 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 15_000
const REDIRECTS = new Set([301, 302, 303, 307, 308])

export interface WebFetchInput {
  readonly url: string
  readonly maxBytes?: number | undefined
}

export interface WebFetchDependencies {
  readonly fetch: (url: URL, init: RequestInit) => Promise<Response>
  readonly lookup: (hostname: string) => Promise<readonly { readonly address: string }[]>
  readonly timeoutMs: number
}

const defaultDependencies: WebFetchDependencies = {
  fetch: globalThis.fetch,
  lookup: async (hostname) => lookup(hostname, { all: true, verbatim: true }),
  timeoutMs: TIMEOUT_MS,
}

const ipv4Number = (address: string): number | undefined => {
  if (isIP(address) !== 4) return undefined
  const parts = address.split('.').map(Number)
  const [first, second, third, fourth] = parts
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) return undefined

  return ((first * 256 + second) * 256 + third) * 256 + fourth
}

const inRange = (value: number, base: number, prefix: number): boolean => {
  const scale = 2 ** (32 - prefix)

  return Math.floor(value / scale) === Math.floor(base / scale)
}

const blockedIpv4 = (value: number): boolean => {
  const ranges = [
    { base: '0.0.0.0', prefix: 8 },
    { base: '10.0.0.0', prefix: 8 },
    { base: '100.64.0.0', prefix: 10 },
    { base: '127.0.0.0', prefix: 8 },
    { base: '169.254.0.0', prefix: 16 },
    { base: '172.16.0.0', prefix: 12 },
    { base: '192.168.0.0', prefix: 16 },
    { base: '224.0.0.0', prefix: 4 },
  ] as const

  return ranges.some(({ base, prefix }) => {
    const network = ipv4Number(base)

    return network !== undefined && inRange(value, network, prefix)
  })
}

/** Node accepts IPv4 at the end of a mapped address; turn that tail into its two hexadecimal groups first. */
const ipv6Groups = (input: string): number[] | undefined => {
  let address = input.toLowerCase().split('%', 1)[0] ?? input
  if (address.includes('.')) {
    const separator = address.lastIndexOf(':')
    const tail = address.slice(separator + 1)
    const ipv4 = ipv4Number(tail)
    if (ipv4 === undefined) return undefined
    const high = Math.floor(ipv4 / 65_536).toString(16)
    const low = (ipv4 % 65_536).toString(16)
    address = `${address.slice(0, separator + 1)}${high}:${low}`
  }

  if (isIP(address) !== 6) return undefined
  const halves = address.split('::')
  if (halves.length > 2) return undefined
  const parse = (part: string | undefined): number[] =>
    part === undefined || part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16))
  const left = parse(halves[0])
  const right = parse(halves[1])
  const missing = 8 - left.length - right.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined

  return [...left, ...Array<number>(missing).fill(0), ...right]
}

/** Whether an address is safe for a backend-side request. DNS results must all pass, not merely the first one. */
export const isPublicAddress = (address: string): boolean => {
  const ipv4 = ipv4Number(address)
  if (ipv4 !== undefined) return !blockedIpv4(ipv4)

  const groups = ipv6Groups(address)
  if (groups === undefined) return false
  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = groups
  if (
    first === undefined || second === undefined || third === undefined || fourth === undefined ||
    fifth === undefined || sixth === undefined || seventh === undefined || eighth === undefined
  ) return false

  // Mapped (and legacy compatible) IPv4 addresses must not bypass the IPv4 range checks through an IPv6 spelling.
  if ([first, second, third, fourth, fifth].every((group) => group === 0) && (sixth === 0 || sixth === 0xffff)) {
    return !blockedIpv4(seventh * 65_536 + eighth)
  }

  const loopback = groups.slice(0, 7).every((group) => group === 0) && eighth === 1
  const unspecified = groups.every((group) => group === 0)
  const linkLocal = (first & 0xffc0) === 0xfe80
  const uniqueLocal = (first & 0xfe00) === 0xfc00
  const multicast = (first & 0xff00) === 0xff00

  return !loopback && !unspecified && !linkLocal && !uniqueLocal && !multicast
}

const assertPublicUrl = async (url: URL, dependencies: WebFetchDependencies): Promise<void> => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('web_fetch only supports http and https')
  if (url.username !== '' || url.password !== '') throw new Error('web_fetch does not accept URL credentials')

  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  const normalized = hostname.replace(/\.$/, '')
  if (normalized === 'localhost' || (isIP(normalized) === 0 && !normalized.includes('.'))) {
    throw new Error('web_fetch does not accept local or single-label hostnames')
  }

  const addresses = isIP(normalized) === 0
    ? await dependencies.lookup(normalized)
    : [{ address: normalized }]
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error(`web_fetch refused the non-public address for ${normalized}`)
  }
}

const readCapped = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - length
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
      chunks.push(chunk)
      length += chunk.byteLength
      if (length >= maxBytes) {
        await reader.cancel()
        break
      }
    }
  } finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result
}

const entity = (match: string): string => {
  const named: Readonly<Record<string, string>> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  }
  const key = match.slice(1, -1)
  if (key.startsWith('#')) {
    const hex = key[1]?.toLowerCase() === 'x'
    const value = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10)
    return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ' '
  }

  return named[key.toLowerCase()] ?? match
}

/** Small HTML-to-text conversion: enough for reading a page, deliberately not a second browser or HTML parser. */
export const htmlText = (html: string): string =>
  html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*>|<\/(?:address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#x[\da-f]+|#\d+|[a-z]+);/gi, (match) => entity(match))
    .replace(/[\t\f\r ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const fetchWeb = async (
  input: WebFetchInput,
  dependencies: WebFetchDependencies = defaultDependencies,
): Promise<string> => {
  const maxBytes = Math.min(input.maxBytes ?? DEFAULT_MAX_BYTES, HARD_MAX_BYTES)
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('maxBytes must be a positive integer')
  const timeout = AbortSignal.timeout(dependencies.timeoutMs)
  let url = new URL(input.url)

  for (let redirects = 0; ; redirects += 1) {
    await assertPublicUrl(url, dependencies)
    const response = await dependencies.fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: timeout,
      headers: { accept: 'text/html, application/json, text/plain, */*' },
    })
    if (!REDIRECTS.has(response.status)) {
      const bytes = await readCapped(response, maxBytes)
      const text = Buffer.from(bytes).toString('utf8')
      const contentType = response.headers.get('content-type') ?? ''

      return /(?:text\/html|application\/xhtml\+xml)/i.test(contentType) ? htmlText(text) : text
    }
    if (redirects >= MAX_REDIRECTS) throw new Error('web_fetch exceeded 5 redirects')
    const location = response.headers.get('location')
    if (location === null) throw new Error('web_fetch received a redirect without a Location header')
    url = new URL(location, url)
  }
}

const webFetchParameters = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'Public http:// or https:// URL to read' },
    maxBytes: { type: 'number', minimum: 1, maximum: HARD_MAX_BYTES },
  },
  required: ['url'],
  additionalProperties: false,
} as const

const webFetch = defineTool({
  name: 'web_fetch',
  description: 'Fetch a public web page or text resource. HTML is reduced to readable text; redirects and private addresses are refused.',
  parameters: webFetchParameters,
  replay: 'safe',
  outputLimits: { maxBytes: HARD_MAX_BYTES, retain: 'head' },
  async execute(args, _api, _context: Context) {
    try {
      // The harness validates this plain JSON schema before execute; its static type cannot infer schema properties.
      const text = await fetchWeb(args as WebFetchInput)

      return { output: [{ type: 'text', text }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return { output: [{ type: 'text', text: `web_fetch failed: ${message}` }], isError: true }
    }
  },
})

/** Env-free by construction: this extension never reads ToolExecutionApi.env. */
export const createWebExtension = () =>
  defineExtension({ name: 'web', tools: [webFetch] })
