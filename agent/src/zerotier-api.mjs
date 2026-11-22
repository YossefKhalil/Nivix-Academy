/* ZeroTier Central (Legacy v1) API — create/authorize networks with a token. */
const BASE = 'https://api.zerotier.com/api/v1'

async function call(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `token ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)
    throw new Error(`${res.status} ${detail}`)
  }
  return data
}

export const ztApi = {
  status: token => call(token, 'GET', '/status'),
  networks: token => call(token, 'GET', '/network'),
  createNetwork: (token, { name = 'Nivix Academy', public: isPublic = true } = {}) =>
    call(token, 'POST', '/network', { config: { name, private: !isPublic } }),
  network: (token, id) => call(token, 'GET', `/network/${id}`),
  authorize: (token, id, memberId) =>
    call(token, 'POST', `/network/${id}/member/${memberId}`, { config: { authorized: true } }),
}