/* Peer transport for LAN play: plain TCP with newline-delimited JSON.
 *
 * Online play does not use this file - it goes through the relay
 * (see relay-client.mjs). This is only for two agents on the same network.
 */
import net from 'node:net'

const once = (emitter, ev) => new Promise((resolve, reject) => {
  emitter.once(ev, resolve)
  emitter.once('error', reject)
})

/** Host side: listen for peer agents on the LAN. */
export async function createPeerListener({ port, onConnection }) {
  const server = net.createServer(sock => onConnection(sock, 'lan'))
  await new Promise((resolve, reject) => { server.listen(port, '0.0.0.0', resolve); server.once('error', reject) })
  return { kind: 'lan', address: null, port, close: () => server.close() }
}

/** Guest side: dial the host agent over the LAN. */
export async function connectPeer({ host, port }) {
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
