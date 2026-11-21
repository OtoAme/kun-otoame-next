import toast from 'react-hot-toast'

export interface SessionMutationResponse<T = unknown> {
  status: number
  ok: boolean
  body: T
}

export type SessionMutationRequest = <T = unknown>(
  path: string,
  options?: { method?: 'POST' | 'DELETE'; body?: Record<string, unknown> }
) => Promise<SessionMutationResponse<T>>

const directRequest: SessionMutationRequest = async (path, options) => {
  try {
    const response = await fetch(path, {
      method: options?.method ?? 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'X-Requested-With': 'kun-fetch',
        ...(options?.body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {})
    })
    return {
      status: response.status,
      ok: response.ok,
      body: await response.json()
    }
  } catch {
    throw new Error('会话请求结果未确认，请检查登录状态后重试')
  }
}

interface WorkerReply {
  id: string
  error?: string
  result?: SessionMutationResponse
}

let workerClient: ReturnType<typeof createWorkerClient> | null = null

const createWorkerClient = () => {
  const worker = new SharedWorker('/session-mutation-worker.js', {
    name: 'kun-session-cookie-mutation-v1'
  })
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let closed = false
  const fail = () => {
    if (closed) return
    closed = true
    window.removeEventListener('pagehide', onPageHide)
    try {
      worker.port.postMessage({ type: 'close' })
    } catch {}
    worker.port.close()
    for (const entry of pending.values()) {
      entry.reject(new Error('会话操作已中断，请重新确认登录状态后重试'))
    }
    pending.clear()
    if (workerClient?.port === worker.port) workerClient = null
  }
  worker.port.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
    const entry = pending.get(data.id)
    if (!entry) return
    pending.delete(data.id)
    if (data.error) entry.reject(new Error(data.error))
    else entry.resolve(data.result)
  }
  worker.onerror = fail
  worker.port.onmessageerror = fail
  worker.port.start()
  const onPageHide = () => fail()
  window.addEventListener('pagehide', onPageHide, { once: true })
  const send = <T>(message: Record<string, unknown>) => {
    if (closed) return Promise.reject<T>(new Error('会话操作已中断，请重试'))
    const id = `${Date.now()}-${Math.random()}`
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try {
        worker.port.postMessage({ ...message, id })
      } catch {
        fail()
      }
    })
  }
  return { send, port: worker.port, isClosed: () => closed }
}

const withWorkerMutation = async <T>(
  action: (request: SessionMutationRequest) => Promise<T>
) => {
  workerClient ??= createWorkerClient()
  const client = workerClient
  const transaction = `${Date.now()}-${Math.random()}`
  await client.send({ type: 'begin', transaction })
  const request: SessionMutationRequest = async <T>(
    path: string,
    options?: { method?: 'POST' | 'DELETE'; body?: Record<string, unknown> }
  ) => {
    const result = await client.send<SessionMutationResponse<T>>({
      type: 'request',
      transaction,
      path,
      options
    })
    if (client.isClosed()) throw new Error('会话操作已中断，请重试')
    return result
  }
  try {
    return await action(request)
  } finally {
    if (!client.isClosed())
      client.port.postMessage({ type: 'end', transaction })
  }
}

export const withSessionMutation = async <T>(
  action: (request: SessionMutationRequest) => Promise<T>
): Promise<T> => {
  let notice: string | undefined
  let acquired = false
  const run = (request: SessionMutationRequest) => {
    acquired = true
    return action(request)
  }
  const message = () =>
    acquired
      ? '正在确认会话操作结果，请勿重复提交'
      : '正在等待前一会话操作完成，请稍候…'
  const waiting = setTimeout(() => {
    notice = toast.loading(message())
  }, 1000)
  const prolonged = setTimeout(() => {
    if (notice) toast.dismiss(notice)
    notice = toast.loading(message())
  }, 15_000)
  try {
    if (navigator.locks?.request) {
      return await navigator.locks.request(
        'kun-session-cookie-mutation-v1',
        () => run(directRequest)
      )
    }
    if (typeof SharedWorker !== 'undefined')
      return await withWorkerMutation(run)
    throw new Error('浏览器无法协调会话操作，请检查浏览器权限后重试')
  } finally {
    clearTimeout(waiting)
    clearTimeout(prolonged)
    if (notice) toast.dismiss(notice)
  }
}
