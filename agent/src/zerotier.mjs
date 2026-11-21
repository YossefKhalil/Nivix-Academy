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

/** ZeroTier interfaces are "ZeroTier One [netid]" on Windows, "ztXXXXXXXX" elsewhere. */
export function detectZeroTier(ifaces = listInterfaces()) {
  return ifaces.find(i => /zerotier/i.test(i.name) || /^zt[0-9a-z]{6,}$/i.test(i.name)) || null
}

export function detectLan(ifaces = listInterfaces()) {
  return (
    ifaces.find(i => isPrivate(i.address) && !/zerotier/i.test(i.name)) ||
    ifaces.find(i => isPrivate(i.address)) ||
    ifaces[0] ||
    null
  )
}

/** Snapshot used by /api/status and the lobby. */
export function networkSummary() {
  const ifaces = listInterfaces()
  const zt = detectZeroTier(ifaces)
  const lan = detectLan(ifaces)
  return {
    interfaces: ifaces,
    zerotier: zt ? { name: zt.name, address: zt.address } : null,
    lan: lan ? { name: lan.name, address: lan.address } : null,
    preferred: (zt || lan)?.address || null,
  }
}