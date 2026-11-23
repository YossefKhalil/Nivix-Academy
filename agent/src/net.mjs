import os from 'node:os'

/** All non-internal IPv4 interfaces. */
export function listInterfaces() {
  const out = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue
      out.push({ name, address: a.address, netmask: a.netmask, mac: a.mac })
    }
  }
  return out
}

const isPrivate = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)

/** Best-guess LAN interface to share with another player. */
export function detectLan(ifaces = listInterfaces()) {
  return ifaces.find(i => isPrivate(i.address)) || ifaces[0] || null
}

/** Snapshot used by /api/status and the lobby. */
export function networkSummary() {
  const ifaces = listInterfaces()
  const lan = detectLan(ifaces)
  return {
    interfaces: ifaces,
    lan: lan ? { name: lan.name, address: lan.address } : null,
    preferred: lan?.address || null,
  }
}
