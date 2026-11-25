/**
 * Ports in LISTEN state from Linux's `/proc/net/tcp` and `/proc/net/tcp6`. Loopback binds are included: SSH local
 * forwarding can reach them inside the container even though another container cannot.
 */
export const parseListeningPorts = (source: string): readonly number[] => {
  const ports = new Set<number>()

  for (const line of source.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    // sl, local_address, rem_address, st — real files have a header, which this shape check skips.
    if (fields.length < 4 || fields[3] !== '0A') continue
    const address = fields[1]
    const separator = address?.lastIndexOf(':') ?? -1
    if (separator < 0) continue

    const text = address?.slice(separator + 1)
    if (text === undefined || !/^[0-9A-Fa-f]{4}$/.test(text)) continue
    const port = Number.parseInt(text, 16)
    // sshd itself is the transport, not a development server the user needs to forward.
    if (port > 0 && port !== 22) ports.add(port)
  }

  return [...ports].sort((left, right) => left - right)
}
