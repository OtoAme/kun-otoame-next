const allowed = new Map([
  ['/api/auth/login', 'POST'],
  ['/api/auth/verify-2fa', 'POST'],
  ['/api/auth/register', 'POST'],
  ['/api/user/status/logout', 'POST'],
  ['/api/user/session', 'DELETE']
])
const queue = []
let active = null

const reply = (port, id, result, error) => {
  try {
    port.postMessage({ id, result, error })
  } catch {}
}
const advance = () => {
  if (active) return
  active = queue.shift() ?? null
  if (active) reply(active.port, active.id)
}
const release = () => {
  active = null
  advance()
}

self.onconnect = ({ ports: [port] }) => {
  let closed = false
  port.onmessage = async ({ data }) => {
    if (data.type === 'close') {
      closed = true
      for (let index = queue.length - 1; index >= 0; index--) {
        if (queue[index].port === port) queue.splice(index, 1)
      }
      if (active?.port === port) {
        active.departed = true
        if (!active.busy) release()
      }
      return
    }
    if (closed) return
    if (data.type === 'begin') {
      queue.push({
        port,
        id: data.id,
        transaction: data.transaction,
        busy: false,
        departed: false
      })
      advance()
      return
    }
    if (
      !active ||
      active.port !== port ||
      active.transaction !== data.transaction
    ) {
      reply(port, data.id, undefined, '会话操作已中断，请重试')
      return
    }
    if (data.type === 'end') {
      if (!active.busy) release()
      return
    }
    if (data.type !== 'request' || active.busy) return
    const transaction = active
    const method = data.options?.method ?? 'POST'
    if (allowed.get(data.path) !== method) {
      reply(port, data.id, undefined, '不支持的会话操作')
      return
    }
    transaction.busy = true
    try {
      const response = await fetch(data.path, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'X-Requested-With': 'kun-fetch',
          ...(data.options?.body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(data.options?.body
          ? { body: JSON.stringify(data.options.body) }
          : {})
      })
      const body = await response.json()
      reply(port, data.id, { status: response.status, ok: response.ok, body })
    } catch {
      reply(
        port,
        data.id,
        undefined,
        '会话请求未确认完成，请重新检查登录状态后重试'
      )
    } finally {
      transaction.busy = false
      if (transaction.departed) release()
    }
  }
  port.start()
}
