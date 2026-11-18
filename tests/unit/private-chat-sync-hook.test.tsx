import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationMessagesResponse,
  PrivateMessage
} from '~/types/api/conversation'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  recover: vi.fn()
}))
vi.mock('~/utils/kunFetch', async (original) => ({
  ...(await original<typeof import('~/utils/kunFetch')>()),
  kunFetchGet: mocks.get,
  kunFetchPut: mocks.put
}))
vi.mock('~/utils/sessionClient', () => ({ refreshUserSession: mocks.recover }))
import { usePrivateChatRequest } from '~/hooks/usePrivateChatRequest'
import { usePrivateChatSync } from '~/hooks/usePrivateChatSync'
import { useUserStore } from '~/store/userStore'
import { KunFetchError } from '~/utils/kunFetch'

const sender = { id: 2, name: 'Synthetic', avatar: '' }
const message = (id: number): PrivateMessage => ({
  id,
  type: 0,
  content: `body ${id}`,
  status: 0,
  isDeleted: false,
  image: null,
  replyTo: null,
  editedAt: null,
  created: new Date(1000 - id),
  sender
})
const page = (
  ids: number[] = [],
  extra: Partial<ConversationMessagesResponse> = {}
): ConversationMessagesResponse => ({
  messages: ids.map(message),
  reviewMessages: [],
  unavailableIds: [],
  total: 200,
  otherUser: sender,
  oldestId: ids[0] ?? null,
  latestId: ids.at(-1) ?? null,
  hasMoreBefore: false,
  hasMoreAfter: false,
  ...extra
})
const read = (readThroughId = 0) => ({
  hasUnreadNotification: false,
  hasUnreadConversation: false,
  readThroughId
})

describe('private chat authorized sync lifecycle', () => {
  let dom: JSDOM
  let root: Root
  let api: ReturnType<typeof usePrivateChatSync>
  let reviewIds: number[]
  let beginRequest: ReturnType<typeof usePrivateChatRequest>
  const accepted = vi.fn()
  const Harness = ({ conversationId = 5 }: { conversationId?: number }) => {
    beginRequest = usePrivateChatRequest(conversationId)
    api = usePrivateChatSync({
      conversationId,
      initialCursor: 0,
      getReviewIds: () => reviewIds,
      onBatch: accepted
    })
    return <div>{String(api.failed)}</div>
  }
  const render = async (conversationId = 5) => {
    await act(async () => {
      root.render(<Harness conversationId={conversationId} />)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  const advance = async (time: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(time)
    })
  }
  const visibility = async (value: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value
    })
    await act(async () => {
      document.dispatchEvent(new dom.window.Event('visibilitychange'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', dom.window.navigator)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    root = createRoot(document.getElementById('root')!)
    useUserStore.setState({
      sessionStatus: 'authenticated',
      sessionContext: 'synthetic-chat',
      sessionGeneration: 7,
      user: { ...useUserStore.getState().user, uid: 1 }
    })
    reviewIds = []
    accepted.mockReset()
    mocks.get.mockReset().mockResolvedValue(page())
    mocks.put.mockReset().mockResolvedValue(read())
    mocks.recover.mockReset().mockResolvedValue(undefined)
  })
  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    dom.window.close()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('fetches new and review in one GET and batches all targets beyond 100', async () => {
    reviewIds = Array.from({ length: 145 }, (_, index) => index + 1)
    await render()
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(mocks.get.mock.calls[0][1]).toMatchObject({
      afterId: 0,
      reviewIds: reviewIds.slice(0, 100).join(',')
    })
    await advance(100)
    expect(mocks.get.mock.calls[1][1].reviewIds).toBe(
      reviewIds.slice(100).join(',')
    )
    expect(mocks.put).toHaveBeenCalledTimes(1)
    await advance(2000)
    expect(mocks.put).toHaveBeenCalledTimes(1)
  })

  it('retries a failed middle batch without advancing and confirms history independently', async () => {
    mocks.get
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 50 }, (_, index) => index * 2 + 1),
          { hasMoreAfter: true }
        )
      )
      .mockRejectedValueOnce(new KunFetchError('network', 'network'))
      .mockResolvedValueOnce(
        page(Array.from({ length: 35 }, (_, index) => 101 + index * 2))
      )
    mocks.put.mockResolvedValue(read(200))
    await render()
    await advance(100)
    expect(mocks.get.mock.calls[1][1].afterId).toBe(99)
    await advance(60_000)
    expect(mocks.get.mock.calls[2][1].afterId).toBe(99)
    expect(
      accepted.mock.calls
        .flatMap(([response]) => response.messages)
        .map((item) => item.id)
    ).toHaveLength(85)
    expect(mocks.put).toHaveBeenCalledTimes(1)
  })

  it('does not let history or review change the new cursor', async () => {
    mocks.get
      .mockResolvedValueOnce(page([10]))
      .mockResolvedValueOnce(page([2, 4], { reviewMessages: [message(1000)] }))
      .mockResolvedValue(page())
    await render()
    let history!: Promise<ConversationMessagesResponse | null>
    await act(async () => {
      history = api.loadHistory(10)
    })
    await advance(0)
    await expect(history).resolves.toMatchObject({ latestId: 4 })
    await advance(2000)
    expect(mocks.get.mock.calls.at(-1)?.[1].afterId).toBe(10)
  })

  it('keeps polling after five foreground minutes and activity restores the fast interval', async () => {
    await render()
    await advance(360_000)
    expect(mocks.get.mock.calls.length).toBeGreaterThan(60)
    const before = mocks.get.mock.calls.length
    await act(async () => {
      api.recordActivity()
      api.recordActivity()
      api.recordActivity()
    })
    await advance(0)
    expect(mocks.get.mock.calls.length - before).toBe(1)
    await advance(2000)
    expect(mocks.get.mock.calls.length - before).toBe(2)
  })

  it('rejects late paused and switched results and suppresses hidden read writes', async () => {
    let resolve!: (response: ConversationMessagesResponse) => void
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    await visibility('hidden')
    await render()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.put).not.toHaveBeenCalled()
    await visibility('visible')
    await visibility('hidden')
    await act(async () => {
      resolve(page([1]))
    })
    expect(accepted).not.toHaveBeenCalled()
    await render(6)
    await visibility('visible')
    expect(mocks.get.mock.calls.at(-1)?.[0]).toBe('/message/conversation/6')
    expect(mocks.get.mock.calls.at(-1)?.[1].afterId).toBe(0)
  })

  it('keeps read failure visible while empty GETs succeed, and retries without new messages', async () => {
    mocks.put
      .mockRejectedValueOnce(new KunFetchError('network', 'network'))
      .mockResolvedValue(read())
    await render()
    await advance(2000)
    expect(api.failed).toBe(true)
    await advance(58_000)
    expect(mocks.put).toHaveBeenCalledTimes(2)
    expect(api.failed).toBe(false)
  })

  it('uses session recovery only for explicit 401 and pauses invalid identity', async () => {
    mocks.get.mockRejectedValueOnce(
      new KunFetchError('arbitrary text', 'http', 401)
    )
    await render()
    expect(mocks.recover).toHaveBeenCalledOnce()
    await act(async () => {
      useUserStore.setState({
        sessionStatus: 'guest',
        sessionContext: null,
        sessionGeneration: 8
      })
    })
    await advance(300_000)
    expect(mocks.get).toHaveBeenCalledOnce()
  })

  it('retains cursor after malformed success and does not accept it', async () => {
    mocks.get.mockResolvedValueOnce(page([2, 1])).mockResolvedValue(page([1]))
    await render()
    expect(accepted).not.toHaveBeenCalled()
    await advance(60_000)
    expect(mocks.get.mock.calls[1][1].afterId).toBe(0)
    expect(accepted).toHaveBeenCalledOnce()
  })
  it('isolates write results by target, session generation and mounted lifetime', async () => {
    await render()
    const original = beginRequest()!
    expect(original.isCurrent()).toBe(true)
    await render(6)
    expect(original.isCurrent()).toBe(false)
    const switched = beginRequest()!
    await act(async () => {
      useUserStore.setState({ sessionGeneration: 8 })
    })
    expect(switched.isCurrent()).toBe(false)
    const latest = beginRequest()!
    await act(async () => {
      root.render(null)
    })
    expect(latest.isCurrent()).toBe(false)
  })

  it('recovers explicit unauthorized writes without automatically repeating them', async () => {
    await render()
    const request = beginRequest()!
    request.fail(new KunFetchError('arbitrary', 'http', 401), 'fallback')
    expect(mocks.recover).toHaveBeenCalledOnce()
    expect(mocks.get).toHaveBeenCalledOnce()
    expect(mocks.put).toHaveBeenCalledOnce()
    await act(async () => {
      useUserStore.setState({ sessionStatus: 'checking' })
    })
    expect(beginRequest()).toBeNull()
  })
})
