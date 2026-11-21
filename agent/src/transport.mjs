/* Peer transport: embedded ZeroTier (libzt) with an OS-socket (LAN) fallback.
 *
 * libzt gives us userspace, encrypted P2P sockets with no system install and no
 * admin. If it isn't available (or no network id is supplied) we fall back to a
 * plain TCP listener so LAN play still works.
 */
import net from 'node:net'
import { mkdirSync } from 'node:fs'

let libPromise = null
function loadLibzt() {
  if (!libPromise) libPromise = import('libzt').catch(() => null)
  return libPromise
}

export async function libztAvailable() {
  return !!(await loadLibzt())
}

const once = (emitter, ev) => new Promise((resolve, reject) => {
  emitter.once(ev, resolve)
  emitter.once('error', reject)
})

/** Start a libzt node and join `network`; resolves the assigned address. */
async function startNode(network, stateDir) {
  const lib = await loadLibzt()
  if (!lib || !network) return null
  mkdirSync(stateDir, { recursive: true })
  const { node } = lib
  const id = await node.start({ path: stateDir })
  await node.joinNetwork(network)
  let address = null
  for (let i = 0; i < 60; i++) {
    address = node.getIPv4Address?.(network) || node.getIPv6Address?.(network) || null
    if (address) break
    await new Promise(r => setTimeout(r, 500))
  }
  return { lib, id, address }
}

/** Host side: listen for peer agents over libzt (or OS TCP). */
export async function createPeerListener({ port, network, stateDir, onConnection }) {
  const nodeInfo = await startNode(network, stateDir)
  if (nodeInfo) {
    const server = nodeInfo.lib.net.createServer(sock => onConnection(sock, 'libzt'))
    await new Promise((resolve, reject) => { server.listen(port, resolve); server.once('error', reject) })
    return { kind: 'libzt', address: nodeInfo.address, port, node: nodeInfo, close: () => server.close() }
  }
  const server = net.createServer(sock => onConnection(sock, 'lan'))
  await new Promise((resolve, reject) => { server.listen(port, '0.0.0.0', resolve); server.once('error', reject) })
  return { kind: 'lan', address: null, port, close: () => server.close() }
}

/** Guest side: dial the host agent over libzt (or OS TCP). */
export async function connectPeer({ host, port, network, stateDir }) {
  const nodeInfo = await startNode(network, stateDir)
  if (nodeInfo) {
    const sock = nodeInfo.lib.net.connect({ host, port })
    await once(sock, 'connect')
    return { socket: sock, kind: 'libzt', node: nodeInfo }
  }
  const sock = net.connect({ host, port })
  await once(sock, 'connect')
  return { socket: sock, kind: 'lan' }
}

/** Newline-delimited JSON over any duplex socket. */
export function jsonLineSocket(socket, onMessage) {
  let buffer = ''
  socket.setEncoding?.('utf8')
  socket.on('data', chunk => {
    buffer += chunk
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      if (!line.trim()) continue
      try { onMessage(JSON.parse(line)) } catch { /* ignore malformed */ }
    }
  })
  return {
    send(obj) { try { socket.write(JSON.stringify(obj) + '\n') } catch { /* closed */ } },
    close() { try { socket.destroy() } catch { /* ignore */ } },
  }
}