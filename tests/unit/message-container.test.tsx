import React, { act, StrictMode } from 'react'
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
  put: vi.fn(),
  confirm: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  pathname: '/message/notice',
  params: 'state=unread',
  seed: vi.fn(),
  scroll: vi.fn(),
  contentReady: true,
  eligible: true
}))
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.params),
  useRouter: () => ({ replace: mocks.replace })
}))
vi.mock('next/link', () => ({
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>
}))
vi.mock('next/image', () => ({
  default: ({ priority, ...props }: any) => <img {...props} />
}))
vi.mock('@heroui/tabs', () => ({
  Tab: () => null,
  Tabs: ({ children, selectedKey, onSelectionChange, ...props }: any) => (
    <div role="tablist" aria-label={props['aria-label']}>
      {React.Children.map(children, (tab: any) => (
        <button
          role="tab"
          aria-selected={tab.key === selectedKey}
          onClick={() => onSelectionChange(tab.key)}
        >
          {tab.props.title}
        </button>
      ))}
    </div>
  )
}))
vi.mock('@heroui/card', () => ({
  Card: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardBody: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  )
}))
vi.mock('~/utils/kunFetch', async (original) => ({
  ...(await original<typeof import('~/utils/kunFetch')>()),
  kunFetchGet: mocks.get,
  kunFetchPut: mocks.put,
  kunFetchDelete: mocks.remove
}))
vi.mock('~/utils/sessionClient', () => ({ refreshUserSession: mocks.refresh }))
vi.mock('~/components/kun/SessionContentBoundary', () => ({
  useSessionContentReady: () => mocks.contentReady
}))
vi.mock('~/components/kun/Header', () => ({ KunHeader: () => null }))
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
    onSeen: (
      msg: Message,
      eligible?: () => boolean,
      immediate?: boolean
    ) => void
    justRead: boolean
  }) => (
    <article data-id={msg.id}>
      <p>{msg.content}</p>
      <span>{justRead ? '刚刚已读' : ''}</span>
      <button onClick={() => onSeen(msg, () => mocks.eligible)}>
        看见 {msg.id}
      </button>
      <button onClick={() => onSeen(msg, undefined, true)}>
        展开 {msg.id}
      </button>
    </article>
  )
}))
vi.mock('@heroui/react', () => ({
  Select: ({
    children,
    selectedKeys,
    onSelectionChange,
    isDisabled,
    ...props
  }: any) => (
    <select
      aria-label={props['aria-label']}
      value={[...selectedKeys][0]}
      disabled={isDisabled}
      onChange={(event) => onSelectionChange(new Set([event.target.value]))}
    >
      {React.Children.map(children, (item: any) => (
        <option value={item.key}>{item.props.children}</option>
      ))}
    </select>
  ),
  SelectItem: () => null,
  Button: ({
    children,
    as: Component = 'button',
    onPress,
    isDisabled,
    isLoading,
    ...props
  }: any) => (
    <Component
      href={props.href}
      aria-label={props['aria-label']}
      aria-pressed={props['aria-pressed']}
      disabled={isDisabled || isLoading}
      onClick={onPress}
    >
      {children}
    </Component>
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
    mocks.params = 'state=unread&limit=30'
    mocks.pathname = '/message/notice'
    mocks.eligible = true
    mocks.contentReady = true
    mocks.get.mockReset().mockResolvedValue(page(90))
    mocks.remove.mockReset()
    mocks.put.mockReset()
    mocks.confirm
      .mockReset()
      .mockImplementation(async (_identity, items) =>
        items.map(({ id }: { id: number }) => ({ id, outcome: 'read' }))
      )
    dom = new JSDOM('<div id="root"></div>', {
      url: 'https://example.test/message/notice'
    })
    dom.window.scrollTo = mocks.scroll
    vi.spyOn(dom.window.document, 'hasFocus').mockReturnValue(true)
    vi.spyOn(dom.window.document, 'visibilityState', 'get').mockReturnValue(
      'visible'
    )
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
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
      (candidate) =>
        (candidate.getAttribute('aria-label') ?? candidate.textContent) === text
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
    expect(
      container
        .querySelector('nav[aria-label="通知分类"] button')
        ?.getAttribute('aria-label')
    ).toBe('全部分类，未读 90 条')
    expect(container.textContent).not.toContain('未经当前身份确认的旧正文')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('shares the first pending list request through StrictMode effect replay', async () => {
    const pending = deferred<NotificationList>()
    mocks.get.mockReturnValue(pending.promise)
    await act(async () =>
      root!.render(
        <StrictMode>
          <MessageContainer />
        </StrictMode>
      )
    )
    expect(mocks.get).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(page(90)))
    expect(container.querySelectorAll('article')).toHaveLength(30)
  })

  it('defaults to twenty, changes page size from the first page and restores each size through history', async () => {
    mocks.params = 'state=unread'
    mocks.get
      .mockReset()
      .mockResolvedValueOnce({
        ...page(90),
        messages: page(90).messages.slice(0, 20),
        nextCursor: 71
      })
      .mockResolvedValueOnce({
        ...page(70),
        messages: page(70).messages.slice(0, 20),
        nextCursor: 51
      })
      .mockResolvedValueOnce({
        ...page(90),
        messages: page(90).messages.slice(0, 10),
        nextCursor: 81
      })
    await render()
    expect(mocks.get.mock.calls[0][1].limit).toBe(20)
    expect(container.querySelectorAll('article')).toHaveLength(20)
    await click('下一页')
    const select = container.querySelector(
      'select[aria-label="每页通知数量"]'
    ) as HTMLSelectElement
    expect([...select.options].map((option) => option.value)).toEqual([
      '10',
      '20',
      '30'
    ])
    await act(async () => {
      select.value = '10'
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    mocks.params = dom.window.location.search.slice(1)
    await render()
    expect(mocks.get.mock.calls[2][1]).toEqual({
      state: 'unread',
      page: 1,
      limit: 10
    })
    expect(container.querySelectorAll('article')).toHaveLength(10)
    mocks.params = 'state=unread'
    await render()
    expect(container.querySelectorAll('article')).toHaveLength(20)
    expect(container.querySelector('article')?.getAttribute('data-id')).toBe(
      '70'
    )
    expect(mocks.get).toHaveBeenCalledTimes(3)
  })

  it('sends an expansion confirmation immediately and keeps the confirmed card in place', async () => {
    await render()
    const first = container.querySelector('article')
    await click('展开 90')
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
      { uid: 7, context: 'ctx-a', generation: 1 },
      [{ id: 90, version: '1' }]
    )
    expect(container.querySelector('article')).toBe(first)
    expect(first?.textContent).toContain('刚刚已读')
    await click('看见 90')
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  it.each(['all', 'help'] as const)(
    'marks the explicit %s scope read and loads the updated list once',
    async (scope) => {
      if (scope === 'help') {
        mocks.params += '&category=help'
        const counts = summary()
        counts.categories.help = { unread: 90, sequence: '90' }
        counts.categories.account = { unread: 0, sequence: '0' }
        useMessageStore.setState({ notifications: counts })
      }
      const after = {
        hasUnreadNotification: false,
        hasUnreadConversation: true,
        notifications: summary(0)
      }
      mocks.put.mockResolvedValue({ read: 90, summary: after })
      await render()
      mocks.get.mockResolvedValueOnce({
        ...page(90),
        messages: [],
        total: 0,
        nextCursor: null
      })
      await click('全部已读')
      expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
        '/message/read',
        { scope },
        expect.objectContaining({
          headers: { 'X-Kun-Notification-Session': 'ctx-a' }
        })
      )
      expect(mocks.get).toHaveBeenCalledTimes(2)
      expect(mocks.seed).toHaveBeenCalledWith(
        expect.objectContaining({ uid: 7 }),
        after,
        1
      )
      expect(container.textContent).toContain('暂无未读消息')
    }
  )

  it('keeps cards and offers another explicit bulk action after a failed request', async () => {
    mocks.put.mockRejectedValueOnce(new Error('synthetic offline'))
    await render()
    const first = container.querySelector('article')
    await click('全部已读')
    expect(container.querySelector('article')).toBe(first)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '再次点击'
    )
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(mocks.seed).not.toHaveBeenCalled()
  })

  it('ignores an old account bulk completion after switching identities', async () => {
    const pending = deferred<any>()
    mocks.put.mockReturnValueOnce(pending.promise)
    await render()
    await click('全部已读')
    await act(async () =>
      useUserStore.setState({
        user: { ...useUserStore.getState().user, uid: 8 },
        sessionContext: 'ctx-b',
        sessionGeneration: 2
      })
    )
    const next = container.querySelector('article')
    await act(async () =>
      pending.resolve({
        read: 90,
        summary: { hasUnreadNotification: false, notifications: summary(0) }
      })
    )
    expect(mocks.seed).not.toHaveBeenCalled()
    expect(container.querySelector('article')).toBe(next)
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it.each(['unread', 'all', 'read'] as const)(
    'shows category unread counts in one sidebar alongside the %s list',
    async (state) => {
      mocks.params = 'state=' + state
      const { MessageLayoutChrome } = await import(
        '~/components/message/MessageLayoutChrome'
      )
      await act(async () =>
        root!.render(
          <MessageLayoutChrome>
            <MessageContainer />
          </MessageLayoutChrome>
        )
      )
      const categories = container.querySelector('nav[aria-label="通知分类"]')!
      const list = container.querySelector('section[aria-label="通知中心"]')!
      expect(categories.querySelectorAll('button')).toHaveLength(8)
      expect(
        categories.querySelector('button')?.getAttribute('aria-label')
      ).toBe('全部分类，未读 90 条')
      expect(categories.querySelector('button')?.textContent).toBe('全部分类90')
      expect(
        categories.querySelector('button[aria-label^="求助动态"]')?.textContent
      ).toBe('求助动态')
      expect(
        container.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent
      ).toBe({ unread: '未读', all: '全部', read: '已读' }[state])
      expect(list.contains(categories)).toBe(false)
      expect(
        container.querySelectorAll('a[href="/message/chat"]')
      ).toHaveLength(1)
      expect(mocks.get).toHaveBeenCalledTimes(1)
    }
  )

  it('changes filters through browser history without a server navigation', async () => {
    await render()
    const history = vi.spyOn(dom.window.history, 'pushState')
    await click('求助动态，未读 0 条')
    expect(history).toHaveBeenCalledWith(
      null,
      '',
      '/message/notice?state=unread&limit=30&category=help'
    )
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('starts a fresh unread view on an explicit filter change while history restoration reuses the previous view', async () => {
    await render()
    await click('求助动态，未读 0 条')
    mocks.params = 'state=unread&limit=30&category=help'
    await render()
    expect(mocks.get).toHaveBeenCalledTimes(2)
    mocks.params = 'state=unread&limit=30'
    await render()
    expect(mocks.get).toHaveBeenCalledTimes(2)
    await click('求助动态，未读 0 条')
    mocks.params = 'state=unread&limit=30&category=help'
    await render()
    expect(mocks.get).toHaveBeenCalledTimes(3)
  })

  it('keeps the displayed cards through subscription and summary changes', async () => {
    await render()
    const card = container.querySelector('article')
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    await act(async () => {
      usePreferenceStore.setState({ observedVersion: 12 })
      useMessageStore.setState({ notifications: summary(84, '91') })
    })
    expect(container.querySelector('article')).toBe(card)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it.each(['follow', 'mention', 'system'])(
    'normalizes the legacy %s entry and switches across all categories without a hidden type',
    async (entry) => {
      mocks.pathname = '/message/' + entry
      mocks.params = ''
      const LegacyPage = (
        await import('../../app/(site)/message/' + entry + '/page')
      ).default
      await act(async () => root!.render(<LegacyPage />))
      const initialCategory = {
        system: 'account',
        follow: 'follow',
        mention: 'mention'
      }[entry]
      expect(mocks.get.mock.calls.at(-1)?.[1]).toEqual({
        state: 'unread',
        category: initialCategory,
        page: 1,
        limit: 20
      })
      const { NOTIFICATION_CATEGORY_LABELS } = await import(
        '~/constants/notification'
      )
      for (const category of NOTIFICATION_CATEGORIES) {
        const label = NOTIFICATION_CATEGORY_LABELS[category]
        const button = [...container.querySelectorAll('button')].find(
          (candidate) =>
            candidate.getAttribute('aria-label')?.startsWith(label + '，')
        )!
        await act(async () => button.click())
        const href = dom.window.location.pathname + dom.window.location.search
        expect(href).toBe('/message/notice?state=unread&category=' + category)
        const next = new URL(href, 'https://example.test')
        mocks.pathname = next.pathname
        mocks.params = next.search.slice(1)
        await act(async () => root!.render(<LegacyPage />))
        expect(mocks.get).toHaveBeenCalledWith(
          '/message/all',
          { state: 'unread', category, page: 1, limit: 20 },
          expect.any(Object)
        )
        expect(
          [...container.querySelectorAll('button')]
            .find((candidate) =>
              candidate.getAttribute('aria-label')?.startsWith(label + '，')
            )
            ?.getAttribute('aria-pressed')
        ).toBe('true')
      }
      await click('全部分类，未读 90 条')
      expect(dom.window.location.pathname + dom.window.location.search).toBe(
        '/message/notice?state=unread'
      )
    }
  )

  it.each(['checking', 'unavailable'] as const)(
    'restores the third unread page and scroll without fetching after same-identity %s recovery',
    async (status) => {
      mocks.get
        .mockResolvedValueOnce(page(90))
        .mockResolvedValueOnce(page(60))
        .mockResolvedValueOnce(page(30))
      await render()
      await click('下一页')
      await click('下一页')
      Object.defineProperty(dom.window, 'scrollY', {
        value: 780,
        configurable: true
      })
      dom.window.dispatchEvent(new dom.window.Event('scroll'))
      await act(async () => useUserStore.getState().setSessionStatus(status))
      expect(container.querySelectorAll('article')).toHaveLength(0)
      Object.defineProperty(dom.window, 'scrollY', {
        value: 0,
        configurable: true
      })
      await act(async () =>
        useUserStore.getState().setSessionStatus('authenticated')
      )
      expect(container.textContent).toContain('第 3 页')
      expect(container.querySelector('article')?.getAttribute('data-id')).toBe(
        '30'
      )
      expect(mocks.scroll).toHaveBeenLastCalledWith(0, 780)
      expect(mocks.get).toHaveBeenCalledTimes(3)
    }
  )

  it('preserves the last displayed scroll when navigation collapses the page before unmount', async () => {
    await render()
    Object.defineProperty(dom.window, 'scrollY', {
      value: 780,
      configurable: true
    })
    dom.window.dispatchEvent(new dom.window.Event('scroll'))
    Object.defineProperty(dom.window, 'scrollY', {
      value: 0,
      configurable: true
    })
    dom.window.history.pushState({}, '', '/help/1')
    dom.window.dispatchEvent(new dom.window.Event('scroll'))
    await act(async () => root!.render(null))
    dom.window.history.pushState({}, '', '/message/notice')
    mocks.scroll.mockClear()
    const commits: number[] = []
    await act(async () =>
      root!.render(
        <React.Profiler
          id="restored"
          onRender={() =>
            commits.push(container.querySelectorAll('article').length)
          }
        >
          <MessageContainer />
        </React.Profiler>
      )
    )
    expect(commits[0]).toBe(30)
    expect(mocks.scroll).toHaveBeenLastCalledWith(0, 780)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('waits for displayed session content before restoring and saving a cached position', async () => {
    await render()
    Object.defineProperty(dom.window, 'scrollY', {
      value: 780,
      configurable: true
    })
    dom.window.dispatchEvent(new dom.window.Event('scroll'))
    await act(async () => root!.render(null))
    mocks.contentReady = false
    Object.defineProperty(dom.window, 'scrollY', {
      value: 0,
      configurable: true
    })
    mocks.scroll.mockClear()
    await render()
    expect(mocks.scroll).not.toHaveBeenCalled()
    dom.window.dispatchEvent(new dom.window.Event('scroll'))
    mocks.contentReady = true
    await render()
    expect(mocks.scroll).toHaveBeenLastCalledWith(0, 780)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it.each(['hidden', 'next', 'reload'])(
    'drops queued confirmations when %s happens before dispatch',
    async (change) => {
      await render()
      if (change === 'reload')
        await act(async () =>
          useMessageStore.setState({ notifications: summary(90, '91') })
        )
      await click('看见 90')
      if (change === 'hidden') {
        vi.spyOn(dom.window.document, 'visibilityState', 'get').mockReturnValue(
          'hidden'
        )
        await act(async () =>
          dom.window.document.dispatchEvent(
            new dom.window.Event('visibilitychange')
          )
        )
        vi.spyOn(dom.window.document, 'visibilityState', 'get').mockReturnValue(
          'visible'
        )
      } else if (change === 'next') await click('下一页')
      else await click('有新通知／有新动态，点击查看')
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120))
      })
      expect(mocks.confirm).not.toHaveBeenCalled()
    }
  )

  it('drops a queued card that becomes occluded before the request starts', async () => {
    await render()
    await click('看见 90')
    mocks.eligible = false
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('allows an issued request to finish without adding old errors to a reloaded page', async () => {
    const pending = deferred<{ id: number; outcome: string }[]>()
    mocks.confirm.mockReturnValueOnce(pending.promise)
    await render()
    await act(async () =>
      useMessageStore.setState({ notifications: summary(90, '91') })
    )
    await click('看见 90')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120))
    })
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    await click('有新通知／有新动态，点击查看')
    await act(async () => pending.resolve([{ id: 90, outcome: 'changed' }]))
    expect(container.textContent).not.toContain('已有新动态')
    expect(container.textContent).not.toContain('刚刚已读')
  })

  it.each(['list', 'clear'])(
    'recovers an explicit 401 from %s through the unified session refresh',
    async (operation) => {
      const { KunFetchError } = await import('~/utils/kunFetch')
      const failure = new KunFetchError('synthetic auth failure', 'http', 401)
      if (operation === 'list') mocks.get.mockRejectedValueOnce(failure)
      else {
        mocks.params = 'state=read'
        mocks.remove.mockRejectedValueOnce(failure)
      }
      await render()
      if (operation === 'clear') {
        await click('清理全部已读')
        await click('确认清理')
      }
      expect(mocks.refresh).toHaveBeenCalledTimes(1)
    }
  )

  it('recovers a changed cookie session and keeps the old list request bound to its displayed identity', async () => {
    const { KunFetchError } = await import('~/utils/kunFetch')
    mocks.get.mockRejectedValueOnce(
      new KunFetchError(
        'session changed',
        'http',
        409,
        null,
        'NOTIFICATION_CONTEXT_CHANGED'
      )
    )
    await render()
    expect(mocks.get.mock.calls[0][2].headers).toEqual({
      'X-Kun-Notification-Session': 'ctx-a'
    })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(container.querySelectorAll('article')).toHaveLength(0)
  })

  it('chooses the unread entry after authentication resolves and retains that view as counts drop', async () => {
    mocks.params = ''
    useUserStore.setState({ sessionStatus: 'checking', sessionContext: null })
    useMessageStore.setState({
      hasUnreadNotification: false,
      notifications: null
    })
    await render()
    expect(container.textContent).toContain('正在获取通知')
    expect(container.textContent).not.toMatch(/确认登录|请登录|暂无消息/)
    expect(container.querySelector('a[href="/message/chat"]')).not.toBeNull()
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
    expect(
      container.querySelector('nav[aria-label="通知分类"]')?.textContent
    ).not.toMatch(/\d/)
  })

  it('offers a session retry and shows the sign-in prompt only after guest confirmation', async () => {
    useUserStore.setState({ sessionStatus: 'unavailable' })
    await render()
    expect(container.textContent).not.toContain('请登录')
    await click('重试')
    expect(mocks.refresh).toHaveBeenCalledOnce()
    await act(async () => useUserStore.getState().confirmGuest())
    expect(container.textContent).toContain('请登录后查看通知')
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('discards the previous session’s open clear confirmation when switching accounts', async () => {
    mocks.params = 'state=read'
    await render()
    await click('清理全部已读')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () =>
      useUserStore.getState().acceptSession(
        {
          ...useUserStore.getState().user,
          uid: 8
        },
        'ctx-b'
      )
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.remove).not.toHaveBeenCalled()
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
    await click('互动提醒，未读 0 条')
    expect(dom.window.location.pathname + dom.window.location.search).toBe(
      '/message/notice?state=read&category=interaction'
    )
    await click('清理已读')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await click('取消')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it.each([
    { category: '', label: '清理全部已读', scope: '全部分类', query: {} },
    {
      category: 'help',
      label: '清理已读',
      scope: '求助动态',
      query: { category: 'help' }
    }
  ])(
    'labels and confirms the $scope clearing scope',
    async ({ category, label, scope, query }) => {
      mocks.params = 'state=read' + (category ? '&category=' + category : '')
      mocks.remove.mockResolvedValueOnce({
        deleted: 1,
        summary: {
          hasUnreadNotification: true,
          hasUnreadConversation: false,
          notifications: summary()
        }
      })
      await render()
      expect(container.textContent).not.toContain('重新加载')
      await click(label)
      expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
        `确认清理${scope}中已读的通知`
      )
      expect(mocks.remove).not.toHaveBeenCalled()
      await click('确认清理')
      expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(
        '/message/read',
        query,
        expect.objectContaining({
          headers: { 'X-Kun-Notification-Session': 'ctx-a' }
        })
      )
      expect(container.querySelector('[role="dialog"]')).toBeNull()
      expect(mocks.get).toHaveBeenCalledTimes(2)
    }
  )

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

  it.each(['unread', 'all', 'read'])(
    'shows the existing empty illustration without pagination on an empty %s first page',
    async (state) => {
      mocks.params = 'state=' + state
      mocks.get.mockResolvedValueOnce({
        ...page(90),
        messages: [],
        total: 0,
        nextCursor: null
      })
      await render()
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        '/null.webp'
      )
      expect(container.querySelector('img')?.getAttribute('alt')).toBe(
        state === 'unread' ? '暂无未读消息' : '暂无消息'
      )
      expect(container.textContent).not.toContain('上一页')
      expect(container.textContent).not.toContain('下一页')
      expect(container.textContent).not.toContain('第 1 页')
      expect(mocks.get).toHaveBeenCalledTimes(1)
    }
  )

  it('keeps the previous page reachable when remaining unread notifications disappear before loading the next page', async () => {
    mocks.get.mockResolvedValueOnce(page(90)).mockResolvedValueOnce({
      ...page(60),
      messages: [],
      total: 30,
      nextCursor: null
    })
    await render()
    await click('下一页')
    expect(container.querySelector('img')?.getAttribute('alt')).toBe(
      '暂无未读消息'
    )
    await click('上一页')
    expect(container.querySelector('article')?.getAttribute('data-id')).toBe(
      '90'
    )
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('distinguishes a failed page from an empty unread collection and retries the attempted page', async () => {
    mocks.get
      .mockResolvedValueOnce(page(90))
      .mockRejectedValueOnce(new Error('synthetic offline'))
      .mockResolvedValueOnce(page(60))
    await render()
    await click('下一页')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.querySelector('img[src="/null.webp"]')).toBeNull()
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
