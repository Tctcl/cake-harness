import { describe, expect, it, vi } from 'vitest'

import { fetchWeb, htmlText, isPublicAddress } from './web.js'
import type { WebFetchDependencies } from './web.js'

const dependencies = (overrides: Partial<WebFetchDependencies> = {}): WebFetchDependencies => ({
  fetch: async () => new Response('ok', { status: 200 }),
  lookup: async () => [{ address: '93.184.216.34' }],
  timeoutMs: 1000,
  ...overrides,
})

describe('isPublicAddress', () => {
  it.each([
    '0.0.0.0',
    '0.255.255.255',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.0',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '224.0.0.1',
    '239.255.255.255',
  ])('blocks the private, local or multicast IPv4 address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each([
    '8.8.8.8',
    '100.128.0.0',
    '172.15.255.255',
    '172.32.0.0',
    '192.169.0.0',
    '223.255.255.255',
  ])('allows public IPv4 address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  it.each([
    '::',
    '::1',
    'fe80::1',
    'febf::1',
    'fc00::1',
    'fdff:ffff::1',
    'ff00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::ffff:169.254.1.1',
    '::ffff:192.168.1.1',
    '::127.0.0.1',
  ])('blocks local, multicast or mapped IPv6 address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each(['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public IPv6 address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true)
    },
  )

  it('rejects malformed addresses rather than treating them as public', () => {
    expect(isPublicAddress('not-an-address')).toBe(false)
    expect(isPublicAddress('999.1.1.1')).toBe(false)
  })
})

describe('fetchWeb', () => {
  it.each(['ftp://example.com/file', 'file:///etc/passwd', 'data:text/plain,hello'])(
    'refuses non-http URL %s before fetching',
    async (url) => {
      const fetch = vi.fn(dependencies().fetch)
      await expect(fetchWeb({ url }, dependencies({ fetch }))).rejects.toThrow('only supports http and https')
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['http://localhost/', 'http://localhost./', 'http://intranet/'])(
    'refuses local and single-label hostname %s',
    async (url) => {
      await expect(fetchWeb({ url }, dependencies())).rejects.toThrow('local or single-label')
    },
  )

  it('refuses when any DNS answer is non-public', async () => {
    const fetch = vi.fn(dependencies().fetch)
    const lookup = vi.fn(async () => [{ address: '93.184.216.34' }, { address: '10.0.0.8' }])

    await expect(fetchWeb({ url: 'https://example.com/' }, dependencies({ fetch, lookup }))).rejects.toThrow(
      'non-public address',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('caps the streamed response at maxBytes and cancels the remainder', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('0123456789abcdef'))
        controller.enqueue(new TextEncoder().encode('this must not be retained'))
      },
      cancel() {
        cancelled = true
      },
    })

    const text = await fetchWeb(
      { url: 'https://example.com/', maxBytes: 16 },
      dependencies({ fetch: async () => new Response(body) }),
    )

    expect(text).toBe('0123456789abcdef')
    expect(cancelled).toBe(true)
  })

  it('enforces the one MiB hard cap even when the caller asks for more', async () => {
    const body = new Uint8Array(1024 * 1024 + 100).fill(97)
    const text = await fetchWeb(
      { url: 'https://example.com/', maxBytes: 2 * 1024 * 1024 },
      dependencies({ fetch: async () => new Response(body) }),
    )

    expect(text).toHaveLength(1024 * 1024)
  })

  it('re-checks a redirect target and refuses a private address before the second request', async () => {
    const fetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
    }))

    await expect(fetchWeb({ url: 'https://example.com/start' }, dependencies({ fetch }))).rejects.toThrow(
      'non-public address',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('resolves and checks every redirect hostname, not only the original one', async () => {
    const fetch = vi.fn(async () => new Response(null, {
      status: 301,
      headers: { location: 'https://private.example/' },
    }))
    const lookup = vi.fn(async (hostname: string) => [
      { address: hostname === 'private.example' ? '192.168.1.4' : '93.184.216.34' },
    ])

    await expect(fetchWeb({ url: 'https://example.com/' }, dependencies({ fetch, lookup }))).rejects.toThrow(
      'non-public address',
    )
    expect(lookup).toHaveBeenNthCalledWith(1, 'example.com')
    expect(lookup).toHaveBeenNthCalledWith(2, 'private.example')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses GET with manual redirect handling and leaves JSON text intact', async () => {
    const fetch = vi.fn(async () => new Response('{"answer":42}', {
      headers: { 'content-type': 'application/json' },
    }))

    await expect(fetchWeb({ url: 'https://example.com/api' }, dependencies({ fetch }))).resolves.toBe('{"answer":42}')
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'GET', redirect: 'manual' }))
  })
})

describe('htmlText', () => {
  it('drops scripts and styles, preserves text and decodes common entities', () => {
    expect(htmlText('<h1>Hello &amp; goodbye</h1><script>secret()</script><style>x{}</style><p>A<br>B</p>')).toBe(
      'Hello & goodbye\nA\nB',
    )
  })
})
