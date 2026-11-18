import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

vi.mock('react-hot-toast', () => ({
  default: { loading: vi.fn(() => 'waiting'), dismiss: vi.fn() }
}))

beforeEach(() => vi.resetModules())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('session mutation authority', () => {
  it('keeps the lock through the actual HTTP response and local commit without aborting on a waiting notice', async () => {
    vi.useFakeTimers()
    let complete!: (response: Response) => void
    const transport = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve
        })
    )
    const order: string[] = []
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name: string, action: () => Promise<void>) => {
          order.push('locked')
          await action()
          order.push('released')
        }
      }
    })
    vi.stubGlobal('fetch', transport)
    const { withSessionMutation } = await import('~/utils/sessionMutation')
    const operation = withSessionMutation(async (request) => {
      await request('/api/user/status/logout')
      order.push('committed')
    })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(order).toEqual(['locked'])
    expect(transport.mock.calls[0][1]?.signal).toBeUndefined()
    complete(Response.json({ revoked: true }))
    await operation
    expect(order).toEqual(['locked', 'committed', 'released'])
  })

  it('does not create a second authority after Web Locks rejects', async () => {
    const worker = vi.fn()
    vi.stubGlobal('SharedWorker', worker)
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    const { withSessionMutation } = await import('~/utils/sessionMutation')
    await expect(withSessionMutation(async () => {})).rejects.toThrow('denied')
    expect(worker).not.toHaveBeenCalled()
  })
})

const workerHarness = async (fetchImplementation: typeof fetch) => {
  const scope = { onconnect: undefined as unknown as (event: unknown) => void }
  runInNewContext(await readFile('public/session-mutation-worker.js', 'utf8'), {
    self: scope,
    fetch: fetchImplementation
  })
  const connect = () => {
    const replies: { id: string; result?: unknown; error?: string }[] = []
    const port = {
      onmessage: undefined as unknown as (event: unknown) => Promise<void>,
      start: vi.fn(),
      postMessage: (data: (typeof replies)[number]) => replies.push(data)
    }
    scope.onconnect({ ports: [port] })
    return {
      replies,
      send: (data: Record<string, unknown>) => port.onmessage({ data })
    }
  }
  return { connect }
}

describe('SharedWorker session HTTP ownership', () => {
  it.each(['close', 'end'])(
    'retains a pending HTTP operation when the page sends %s',
    async (departure) => {
      let complete!: (response: Response) => void
      const transport = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve
          })
      )
      const { connect } = await workerHarness(transport)
      const first = connect()
      const second = connect()
      await first.send({
        type: 'begin',
        id: 'begin-first',
        transaction: 'first'
      })
      const pending = first.send({
        type: 'request',
        id: 'http-first',
        transaction: 'first',
        path: '/api/user/status/logout'
      })
      await second.send({
        type: 'begin',
        id: 'begin-second',
        transaction: 'second'
      })
      await first.send({ type: departure, transaction: 'first' })
      expect(second.replies).toEqual([])
      complete(Response.json({ revoked: true }))
      await pending
      if (departure === 'close') {
        expect(second.replies.map((reply) => reply.id)).toEqual([
          'begin-second'
        ])
      } else {
        expect(second.replies).toEqual([])
        await first.send({ type: 'end', transaction: 'first' })
        expect(second.replies.map((reply) => reply.id)).toEqual([
          'begin-second'
        ])
      }
    }
  )

  it('does not expire a grant when a page disappears without a close message', async () => {
    vi.useFakeTimers()
    const { connect } = await workerHarness(vi.fn())
    const first = connect()
    const second = connect()
    await first.send({ type: 'begin', id: 'first', transaction: 'first' })
    await second.send({ type: 'begin', id: 'second', transaction: 'second' })
    await vi.advanceTimersByTimeAsync(300_000)
    expect(second.replies).toEqual([])
    await first.send({ type: 'close' })
    expect(second.replies.map((reply) => reply.id)).toEqual(['second'])
  })

  it('limits the worker to the fixed authentication endpoints', async () => {
    const transport = vi.fn()
    const { connect } = await workerHarness(transport)
    const client = connect()
    await client.send({ type: 'begin', id: 'begin', transaction: 'test' })
    await client.send({
      type: 'request',
      id: 'bad',
      transaction: 'test',
      path: 'https://external.invalid/api/auth/login'
    })
    expect(transport).not.toHaveBeenCalled()
    expect(client.replies.at(-1)?.error).toBe('不支持的会话操作')
  })

  it('reports a failed HTTP result without replaying a credential request', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('offline'))
    const { connect } = await workerHarness(transport)
    const client = connect()
    await client.send({ type: 'begin', id: 'begin', transaction: 'test' })
    await client.send({
      type: 'request',
      id: 'http',
      transaction: 'test',
      path: '/api/auth/login',
      options: { body: { name: 'synthetic' } }
    })
    expect(transport).toHaveBeenCalledTimes(1)
    expect(client.replies.at(-1)?.error).toContain('未确认完成')
  })
})
