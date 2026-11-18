import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type {
  Message,
  NotificationList,
  NotificationSummary
} from '~/types/api/message'
import { NOTIFICATION_CATEGORIES } from '~/constants/notification'

globalThis.React = React
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  replace: vi.fn(),
  params: 'state=unread',
  seed: vi.fn(),
  scroll: vi.fn()
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/message/notice',
  useSearchParams: () => new URLSearchParams(mocks.params),
  useRouter: () => ({ replace: mocks.replace })
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.get,
  kunFetchDelete: mocks.remove
}))
vi.mock('~/utils/messageSync', () => ({
  beginUnreadRead: () => 1,
  seedSessionUnread: mocks.seed
}))
vi.mock('~/utils/notificationReading', async (original) => ({
  ...(await original<typeof import('~/utils/notificationReading')>()),
  confirmNotificationItems: mocks.confirm
}))
vi.mock('~/components/message/MessageCard', () => ({
  MessageCard: ({
    msg,
    onSeen,
    justRead
  }: {
    msg: Message
    onSeen: (msg: Message) => void
    justRead: boolean
  }) => (
    <article data-id={msg.id}>
      <p>{msg.content}</p>
      <span>{justRead ? '刚刚已读' : ''}</span>
      <button onClick={() => onSeen(msg)}>看见 {msg.id}</button>
    </article>
  )
}))
vi.mock('@heroui/react', () => ({
  Button: ({ children, onPress, isDisabled, isLoading, ...props }: any) => (
    <button
      aria-pressed={props['aria-pressed']}
      disabled={isDisabled || isLoading}
      onClick={onPress}
    >
      {children}
    </button>
  ),
  Modal: ({ children, isOpen }: any) =>
    isOpen ? <div role="dialog">{children}</div> : null,
  ModalContent: ({ children }: any) => <div>{children}</div>,
  ModalHeader: ({ children }: any) => <h2>{children}</h2>,
  ModalBody: ({ children }: any) => <div>{children}</div>,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
  useDisclosure: () => {
    const [isOpen, setOpen] = React.useState(false)
    return {
      isOpen,
      onOpen: () => setOpen(true),
      onClose: () => setOpen(false),
      onOpenChange: setOpen
    }
  }
}))
vi.mock('~/components/kun/Loading', () => ({
  KunLoading: ({ hint }: any) => <p role="status">{hint}</p>
}))
vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: ({ page, onPageChange }: any) => (
    <button onClick={() => onPageChange(page + 1)}>页码下一页</button>
  )
}))

const summary = (unread = 90, sequence = '90'): NotificationSummary => ({
  unread,
  sequence,
  categories: Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [
      category,
      {
        unread: category === 'account' ? unread : 0,
        sequence: category === 'account' ? sequence : '0'
      }
    ])
  ) as NotificationSummary['categories']
})
const page = (upper: number, sequence = '90'): NotificationList => ({
  messages: Array.from({ length: 30 }, (_, index) => ({
    id: upper - index,
    type: 'system',
    eventType: 'site-announcement',
    category: 'account',
    contentVersion: '1',
    content: '通知 ' + (upper - index),
    status: 0,
    link: '/help/' + (upper - index),
    created: '2026-11-18T00:00:00.000Z',
    sender: null
  })),
  total: 90,
  upperId: 90,
  nextCursor: upper > 30 ? upper - 29 : null,
  contentSequence: sequence
})
const deferred = <Value,>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('notification list browsing and concrete reading', () => {
  let root: Root | undefined
  let dom: JSDOM
  let container: HTMLElement
  let MessageContainer: (typeof import('~/components/message/Container'))['MessageContainer']
  let useUserStore: (typeof import('~/store/userStore'))['useUserStore']
  let useMessageStore: (typeof import('~/store/messageStore'))['useMessageStore']

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.params = 'state=unread'
    mocks.get.mockReset().mockResolvedValue(page(90))
    mocks.remove.mockReset()
    mocks.confirm
      .mockReset()
      .mockImplementation(async (_identity, items) =>
        items.map(({ id }: { id: number }) => ({ id, outcome: 'read' }))
      )
    dom = new JSDOM('<div id="root"></div>', {
      url: 'https://example.test/message/notice'
    })
    dom.window.scrollTo = mocks.scroll
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    ;({ useUserStore } = await import('~/store/userStore'))
    ;({ useMessageStore } = await import('~/store/messageStore'))
    useUserStore.setState({ sessionStatus: 'guest', sessionContext: null })
    useUserStore.setState({
      user: { ...useUserStore.getState().user, uid: 7 },
      sessionStatus: 'authenticated',
      sessionContext: 'ctx-a',
      sessionGeneration: 1
    })
    useMessageStore.setState({
      hasUnreadNotification: true,
      hasUnreadConversation: false,
      notifications: summary()
    })
    ;({ MessageContainer } = await import('~/components/message/Container'))
    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    dom.window.close()
    vi.unstubAllGlobals()
  })
  const render = async () => {
    await act(async () =>
      root!.render(
        <MessageContainer
          initialMessages={[
            { ...page(90).messages[0], content: '未经当前身份确认的旧正文' }
          ]}
        />
      )
    )
  }
  const click = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === text
    )
    expect(button, text).toBeDefined()
    await act(async () => button!.click())
  }

  it('loads only thirty of ninety without confirming or trusting old server content', async () => {
    await render()
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(
      '/message/all',
      { state: 'unread', page: 1, limit: 30 },
      expect.objectContaining({ preserveErrorStatus: true })
    )
    expect(container.querySelectorAll('article')).toHaveLength(30)
    expect(container.textContent).toContain('全部分类 · 90')
    expect(container.textContent).not.toContain('未经当前身份确认的旧正文')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('chooses the unread entry after authentication resolves and retains that view as counts drop', async () => {
    mocks.params = ''
    useUserStore.setState({ sessionStatus: 'checking', sessionContext: null })
    useMessageStore.setState({
      hasUnreadNotification: false,
      notifications: null
    })
    await render()
    expect(mocks.get).not.toHaveBeenCalled()
    await act(async () => {
      useUserStore.setState({
        sessionStatus: 'authenticated',
        sessionContext: 'ctx-a'
      })
      useMessageStore.setState({
        hasUnreadNotification: true,
        notifications: summary()
      })
    })
    expect(mocks.get.mock.calls[0][1].state).toBe('unread')
    await act(async () =>
      useMessageStore.setState({
        hasUnreadNotification: false,
        notifications: summary(0)
      })
    )
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('第 1 页')
  })

  it('honors an explicit all view after authentication resolves with unread notifications', async () => {
    mocks.params = 'state=all'
    useUserStore.setState({ sessionStatus: 'checking', sessionContext: null })
    useMessageStore.setState({
      hasUnreadNotification: false,
      notifications: null
    })
    await render()
    await act(async () => {
      useUserStore.setState({
        sessionStatus: 'authenticated',
        sessionContext: 'ctx-a'
      })
      useMessageStore.setState({
        hasUnreadNotification: true,
        notifications: summary()
      })
    })
    expect(mocks.get.mock.calls[0][1].state).toBe('all')
  })

  it('confirms only six seen versions and leaves the cards in place', async () => {
    await render()
    for (let id = 90; id >= 85; id--) await click('看见 ' + id)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
      { uid: 7, context: 'ctx-a', generation: 1 },
      Array.from({ length: 6 }, (_, index) => ({
        id: 90 - index,
        version: '1'
      }))
    )
    expect(container.querySelectorAll('article')).toHaveLength(30)
    expect(container.textContent?.match(/刚刚已读/g)).toHaveLength(6)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('keeps a fixed upper bound over three shrinking unread pages and restores cached positions', async () => {
    mocks.get
      .mockResolvedValueOnce(page(90))
      .mockResolvedValueOnce(page(60))
      .mockResolvedValueOnce(page(30))
    await render()
    for (let id = 90; id > 60; id--) await click('看见 ' + id)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    await click('下一页')
    await click('下一页')
    expect(mocks.get.mock.calls.map((call) => call[1])).toEqual([
      { state: 'unread', page: 1, limit: 30 },
      { state: 'unread', page: 2, limit: 30, upperId: 90, cursor: 61 },
      { state: 'unread', page: 3, limit: 30, upperId: 90, cursor: 31 }
    ])
    expect(
      [...container.querySelectorAll('article')].map((element) =>
        Number(element.getAttribute('data-id'))
      )
    ).toEqual(Array.from({ length: 30 }, (_, index) => 30 - index))
    await click('上一页')
    await click('上一页')
    expect(container.textContent).toContain('第 1 页')
    expect(container.textContent?.match(/刚刚已读/g)).toHaveLength(30)
    expect(mocks.get).toHaveBeenCalledTimes(3)
  })

  it('announces a newer content sequence without replacing or rebasing displayed content', async () => {
    await render()
    await act(async () =>
      useMessageStore.setState({ notifications: summary(90, '91') })
    )
    expect(container.textContent).toContain('有新通知／有新动态，点击查看')
    expect(mocks.get).toHaveBeenCalledTimes(1)
    await act(async () =>
      useMessageStore.setState({ notifications: summary(84, '90') })
    )
    expect(container.textContent).not.toContain('有新通知／有新动态，点击查看')
    expect(container.querySelectorAll('article')).toHaveLength(30)
  })

  it('applies explicit filters independently and cancels clearing without a write', async () => {
    mocks.params = 'state=read&category=help'
    await render()
    expect(mocks.get.mock.calls[0][1]).toMatchObject({
      state: 'read',
      category: 'help'
    })
    await click('互动消息 · 0')
    expect(mocks.replace).toHaveBeenCalledWith(
      '/message/notice?state=read&category=interaction',
      { scroll: false }
    )
    await click('清理当前分类已读')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await click('取消')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('ignores an old identity response while the new identity loads its own content', async () => {
    const pending = deferred<NotificationList>()
    mocks.get.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
      ...page(60),
      messages: [{ ...page(60).messages[0], content: '新账号正文' }]
    })
    await render()
    await act(async () =>
      useUserStore.setState({
        user: { ...useUserStore.getState().user, uid: 8 },
        sessionContext: 'ctx-b',
        sessionGeneration: 2
      })
    )
    await act(async () =>
      pending.resolve({
        ...page(90),
        messages: [{ ...page(90).messages[0], content: '旧账号迟到正文' }]
      })
    )
    expect(container.textContent).toContain('新账号正文')
    expect(container.textContent).not.toContain('旧账号迟到正文')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('distinguishes a failed page from an empty unread collection and retries the attempted page', async () => {
    mocks.get
      .mockResolvedValueOnce(page(90))
      .mockRejectedValueOnce(new Error('synthetic offline'))
      .mockResolvedValueOnce(page(60))
    await render()
    await click('下一页')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.textContent).not.toContain('没有未读通知')
    expect(container.querySelectorAll('article')).toHaveLength(30)
    await click('重试')
    expect(mocks.get.mock.calls[2][1]).toMatchObject({
      page: 2,
      cursor: 61,
      upperId: 90
    })
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('article')?.getAttribute('data-id')).toBe(
      '60'
    )
  })
})
