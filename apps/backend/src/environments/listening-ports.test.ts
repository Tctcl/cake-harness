import { describe, expect, it } from 'vitest'

import { parseListeningPorts } from './listening-ports.js'

// Captured in the format Linux emits: IPv4, IPv6, loopback-only, listening and non-listening sockets.
const PROC_NET = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 10001 1 0000000000000000 100 0 0 10 0
   1: 0100007F:14D5 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 10002 1 0000000000000000 100 0 0 10 0
   2: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 10003 1 0000000000000000 100 0 0 10 0
   3: 00000000:01BB 00000000:0000 01 00000000:00000000 00:00000000 00000000  1000        0 10004 1 0000000000000000 100 0 0 10 0
   4: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 10005 1 0000000000000000 100 0 0 10 0
   5: 0000000000000000FFFF00000100007F:1435 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 10006 1 0000000000000000 100 0 0 10 0
`

describe('parseListeningPorts', () => {
  it('reads listening IPv4 and IPv6 ports, including loopback binds, and deduplicates them', () => {
    expect(parseListeningPorts(PROC_NET)).toEqual([5173, 5333, 8080])
  })

  it('ignores headers, malformed lines and port zero', () => {
    expect(parseListeningPorts('sl local_address rem_address st\n0: 00000000:0000 00000000:0000 0A\nnot a socket')).toEqual([])
  })
})
