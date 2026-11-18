import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  seed: vi.fn(),
  refresh: vi.fn()
}))
vi.mock('~/utils/kunFetch', async (original) => ({
  ...(await original<typeof import('~/utils/kunFetch')>()),
  kunFetchPut: mocks.put
}))
vi.mock('~/utils/sessionClient', () => ({ refreshUserSession: mocks.refresh }))
vi.mock('~/utils/messageSync', () => ({
  beginUnreadRead: () => 5,
  seedSessionUnread: mocks.seed
}))

class TestChannel {
  static instances: TestChannel[] = []
  listeners = new Set<(event: MessageEvent) => void>()
  postMessage = vi.fn()
  constructor() {
    TestChannel.instances.push(this)
  }
  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener)
  }
  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener)
  }
  emit(data: unknown) {
    for (const listener of this.listeners) listener({ data } as MessageEvent)
  }
}

const token = 'd9266b7b-b1b7-40aa-965d-cf29994a7c13'
const identity = { uid: 7, context: 'notification-context', generation: 1 }
const item = { id: 80, version: '2' }
const result = { id: 80, outcome: 'read' }
let dom: JSDOM
let reading: typeof import('~/utils/notificationReading')
let cache: typeof import('~/utils/notificationViewCache')
let useUserStore: (typeof import('~/store/userStore'))['useUserStore']

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  TestChannel.instances = []
  dom = new JSDOM('', { url: 'https://example.test/help/4' })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('BroadcastChannel', TestChannel)
  ;({ useUserStore } = await import('~/store/userStore'))
  useUserStore.setState({
    user: { ...useUserStore.getState().user, uid: 7 },
    sessionStatus: 'authenticated',
    sessionContext: identity.context,
    sessionGeneration: 1
  })
  reading = await import('~/utils/notificationReading')
  cache = await import('~/utils/notificationViewCache')
  mocks.put.mockResolvedValue({ results: [result], summary: {} })
})
afterEach(() => {
  dom.window.close()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('notification reading identity and detail handoff', () => {
  it('recovers an explicit confirmation 401 through unified session refresh and propagates failure', async () => {
    const { KunFetchError } = await import('~/utils/kunFetch')
    mocks.put.mockRejectedValueOnce(
      new KunFetchError('synthetic auth failure', 'http', 401)
    )
    await expect(
      reading.confirmNotificationItems(identity, [item])
    ).rejects.toMatchObject({ status: 401 })
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(mocks.seed).not.toHaveBeenCalled()
  })
  it('deduplicates a list and detail confirmation before and after success without removing cached cards', async () => {
    const view = cache.notificationView(identity, 'unread')
    view.pages.push({
      messages: [{ ...item, contentVersion: item.version, status: 0 } as any],
      total: 90,
      upperId: 90,
      nextCursor: 61,
      contentSequence: '90',
      justRead: [],
      scrollY: 650
    })
    const [list, detail] = await Promise.all([
      reading.confirmNotificationItems(identity, [item]),
      reading.confirmNotificationItems(identity, [item], '/help/4')
    ])
    expect(list).toEqual([result])
    expect(detail).toEqual([result])
    await reading.confirmNotificationItems(identity, [item], '/help/4')
    expect(mocks.put).toHaveBeenCalledTimes(1)
    expect(view.pages[0]).toMatchObject({
      messages: [{ status: 1 }],
      justRead: [80],
      contentSequence: '90',
      scrollY: 650,
      total: 90
    })
    await reading.confirmNotificationItems(identity, [
      { ...item, version: '3' }
    ])
    expect(mocks.put).toHaveBeenCalledTimes(2)
  })

  it('does not seed a summary or mutate the new account cache after an old request completes', async () => {
    let complete!: (value: unknown) => void
    mocks.put.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve
      })
    )
    const pending = reading.confirmNotificationItems(identity, [item])
    useUserStore.setState({
      user: { ...useUserStore.getState().user, uid: 8 },
      sessionContext: 'other-context',
      sessionGeneration: 2
    })
    const view = cache.notificationView(
      { uid: 8, context: 'other-context', generation: 2 },
      'unread'
    )
    view.pages.push({
      messages: [{ id: 80, contentVersion: '2', status: 0 } as any],
      total: 1,
      upperId: 80,
      nextCursor: null,
      contentSequence: '1',
      justRead: [],
      scrollY: 0
    })
    complete({ results: [result], summary: {} })
    await pending
    expect(mocks.seed).not.toHaveBeenCalled()
    expect(view.pages[0].messages[0].status).toBe(0)
  })

  it('matches the exact local destination and expires handoff metadata without storing notification bodies', async () => {
    const target = '/help/4?tab=answers#answer-8'
    const href = reading.notificationEntryHref(target, token)
    reading.rememberNotificationEntry(token, { identity, item, target })
    expect(href).toContain('notification-entry=')
    expect(
      await reading.resolveNotificationEntry(identity, token, href)
    ).toMatchObject({ identity, item, target })
    expect(
      reading.notificationTargetMatches(target, '/help/4?tab=answers#answer-9')
    ).toBe(false)
    expect(
      reading.notificationTargetMatches(
        target,
        'https://other.test/help/4?tab=answers#answer-8'
      )
    ).toBe(false)
    expect(
      reading.notificationEntryHref('https://other.test/help/4', token)
    ).toBe('https://other.test/help/4')
    expect(reading.notificationEntryHref('/issue/4', token)).toBe(
      '/workspace/issues/4?notification-entry=' + token
    )
    expect(
      reading.notificationTargetMatches(
        '/issue/4',
        '/workspace/issues/4?notification-entry=' + token
      )
    ).toBe(true)
    expect(
      reading.notificationTargetMatches(
        '/issue/4',
        '/workspace/issues/5?notification-entry=' + token
      )
    ).toBe(false)
    const bus = TestChannel.instances[0]
    bus.emit({ kind: 'request', token, uid: 7, context: identity.context })
    expect(bus.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'entry',
        entry: expect.objectContaining({ item, target })
      })
    )
    expect(JSON.stringify(bus.postMessage.mock.calls)).not.toContain('content')
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 11 * 60_000)
    bus.postMessage.mockClear()
    bus.emit({ kind: 'request', token, uid: 7, context: identity.context })
    expect(bus.postMessage).not.toHaveBeenCalled()
  })

  it('ignores malformed or wrong-account cross-tab metadata and binds a valid response to this tab generation', async () => {
    const current = '/help/4?notification-entry=' + token
    const pending = reading.resolveNotificationEntry(identity, token, current)
    const bus = TestChannel.instances[0]
    expect(() => bus.emit({ kind: 'entry', token, entry: {} })).not.toThrow()
    bus.emit({
      kind: 'entry',
      token,
      entry: {
        identity: { ...identity, uid: 8 },
        item,
        target: '/help/4',
        enteredAt: Date.now()
      }
    })
    bus.emit({
      kind: 'entry',
      token,
      entry: {
        identity,
        item: { id: -1, version: '2' },
        target: '/help/4',
        enteredAt: Date.now()
      }
    })
    bus.emit({
      kind: 'entry',
      token,
      entry: {
        identity: { ...identity, generation: 90 },
        item,
        target: '/help/4',
        enteredAt: Date.now()
      }
    })
    expect(await pending).toMatchObject({ identity, item })
    expect(mocks.put).not.toHaveBeenCalled()
  })
})
