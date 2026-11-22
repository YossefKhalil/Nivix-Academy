/* LAN / ZeroTier room discovery.
 *
 * The host announces its room on the local subnet(s) over UDP; a guest only
 * needs the room code and the app finds the host automatically. Works on a
 * plain LAN and on a ZeroTier network (both are broadcast domains).
 */
import dgram from 'node:dgram'
import os from 'node:os'

const PORT = 7787
const MAGIC = 'NIVIX1'

function broadcastAddresses() {
  const out = new Set(['255.255.255.255'])
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const ip = a.address.split('.').map(Number)
      const mask = (a.netmask || '255.255.255.0').split('.').map(Number)
      out.add(ip.map((o, i) => ((o & mask[i]) | (~mask[i] & 255))).join('.'))
    }
  }
  return [...out]
}

export function startAnnouncer({ code, getInfo }) {
  const sock = dgram.createSocket('udp4')
  sock.on('message', (msg, rinfo) => {
    const text = msg.toString()
    if (!text.startsWith(`${MAGIC}?`)) return
    const want = text.slice(MAGIC.length + 1).trim().toUpperCase()
    if (want && want !== code) return
    const payload = JSON.stringify({ magic: MAGIC, code, ...getInfo() })
    try { sock.send(payload, rinfo.port, rinfo.address) } catch { /* ignore */ }
  })
  sock.on('error', () => {})
  sock.bind(PORT, () => { try { sock.setBroadcast(true) } catch { /* ignore */ } })
  return { close: () => { try { sock.close() } catch { /* ignore */ } } }
}

export function discover(code, timeoutMs = 1600) {
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4')
    const found = []
    const want = (code || '').trim().toUpperCase()

    sock.on('message', (msg, rinfo) => {
      try {
        const j = JSON.parse(msg.toString())
        if (j.magic === MAGIC && (!want || j.code === want)) {
          found.push({ host: rinfo.address, port: j.port, network: j.network || null, code: j.code })
        }
      } catch { /* ignore */ }
    })
    sock.on('error', () => {})
    sock.bind(() => {
      try { sock.setBroadcast(true) } catch { /* ignore */ }
      const probe = Buffer.from(`${MAGIC}?${want}`)
      for (const addr of broadcastAddresses()) {
        try { sock.send(probe, PORT, addr) } catch { /* ignore */ }
      }
    })

    setTimeout(() => { try { sock.close() } catch { /* ignore */ } resolve(found[0] || null) }, timeoutMs)
  })
}