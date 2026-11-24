import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { expect, it, vi } from 'vitest'
import type { Message } from '~/types/api/message'

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/message/notice',
  useSearchParams: () => new URLSearchParams('state=unread'),
  useRouter: () => ({ replace: vi.fn() })
}))
vi.mock('next/link', () => ({
  default: ({ children, prefetch, ...props }: any) => (
    <a {...props}>{children}</a>
  )
}))
vi.mock('~/utils/kunFetch', async (original) => ({
  ...(await original<typeof import('~/utils/kunFetch')>()),
  kunFetchGet: mocks.get,
  kunFetchPut: mocks.put,
  kunFetchDelete: vi.fn()
}))
vi.mock('~/utils/messageSync', () => ({
  beginUnreadRead: () => 1,
  seedSessionUnread: vi.fn()
}))
vi.mock('~/utils/sessionClient', () => ({ refreshUserSession: vi.fn() }))
vi.mock('~/components/kun/floating-card/KunAvatar', () => ({
  KunAvatar: () => null
}))
vi.mock('~/components/kun/Loading', () => ({
  KunLoading: () => <p>正在加载</p>
}))
vi.mock('~/components/kun/Pagination', () => ({ KunPagination: () => null }))
vi.mock('@heroui/card', () => ({
  Card: ({ children, ...props }: any) => (
    <article {...props}>{children}</article>
  ),
  CardBody: ({ children }: any) => <div>{children}</div>
}))
vi.mock('@heroui/avatar', () => ({ Avatar: () => null }))
vi.mock('@heroui/tabs', () => ({ Tabs: () => null, Tab: () => null }))
vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: any) => <span>{children}</span>
}))
vi.mock('@heroui/button', () => ({
  Button: ({ children, onPress }: any) => (
    <button onClick={onPress}>{children}</button>
  )
}))
vi.mock('@heroui/react', () => ({
  Button: ({ children, onPress, isDisabled, isLoading }: any) => (
    <button disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  Modal: () => null,
  ModalBody: () => null,
  ModalContent: () => null,
  ModalFooter: () => null,
  ModalHeader: () => null,
  useDisclosure: () => ({
    isOpen: false,
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onOpenChange: vi.fn()
  })
}))

it('restarts a partially occluded card for a fresh continuous interval without resending the other confirmed card', async () => {
  vi.useFakeTimers()
  const dom = new JSDOM('<main id="root"></main><div id="cover"></div>', {
    url: 'https://example.test/message/notice',
    pretendToBeVisual: true
  })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle)
  vi.stubGlobal('performance', { now: () => Date.now() })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  dom.window.scrollTo = vi.fn()
  document.hasFocus = () => true
  Object.defineProperty(document, 'visibilityState', { value: 'visible' })
  let occluded = false
  const bounds = (id: string | undefined) => {
    const top = id === '2' ? 100 : 300
    return {
      top,
      bottom: top + 80,
      left: 20,
      right: 320,
      width: 300,
      height: 80
    } as DOMRect
  }
  vi.spyOn(
    dom.window.HTMLElement.prototype,
    'getBoundingClientRect'
  ).mockImplementation(function (this: HTMLElement) {
    return bounds(
      this.closest('[data-notification-id]')?.getAttribute(
        'data-notification-id'
      ) ?? undefined
    )
  })
  document.elementFromPoint = (_horizontal, vertical) => {
    const id = vertical < 200 ? '2' : '1'
    return occluded && id === '2'
      ? document.getElementById('cover')
      : document.querySelector(
          `[data-notification-id="${id}"] [data-testid="message-content"]`
        )
  }
  const messages: Message[] = [2, 1].map((id) => ({
    id,
    type: 'system',
    content: '合成正文 ' + id,
    contentVersion: '1',
    status: 0,
    sender: null,
    created: '2026-11-18T00:00:00Z',
    link: '/help/' + id
  }))
  mocks.get.mockResolvedValue({
    messages,
    total: 2,
    upperId: 2,
    nextCursor: null,
    contentSequence: '2'
  })
  mocks.put.mockImplementation(async (_path, body) => ({
    results: body.items.map((item: { id: number }) => ({
      id: item.id,
      outcome: 'read'
    })),
    summary: {}
  }))
  const { useUserStore } = await import('~/store/userStore')
  useUserStore.setState({
    user: { ...useUserStore.getState().user, uid: 7 },
    sessionStatus: 'authenticated',
    sessionContext: 'composition',
    sessionGeneration: 1
  })
  const { MessageContainer } = await import('~/components/message/Container')
  const root = createRoot(document.getElementById('root')!)
  try {
    await act(async () => root.render(<MessageContainer />))
    await act(async () => vi.advanceTimersByTime(1000))
    expect(mocks.put).not.toHaveBeenCalled()
    occluded = true
    await act(async () => vi.advanceTimersByTime(100))
    expect(mocks.put).toHaveBeenCalledExactlyOnceWith(
      '/message/read',
      { items: [{ id: 1, version: '1' }] },
      expect.any(Object)
    )
    expect(
      document.querySelector('[data-notification-id="2"]')?.textContent
    ).toContain('未读')
    expect(
      document.querySelector('[data-notification-id="1"]')?.textContent
    ).toContain('刚刚已读')
    occluded = false
    await act(async () => vi.advanceTimersByTime(1000))
    expect(mocks.put).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTime(200))
    expect(mocks.put.mock.calls.map((call) => call[1].items)).toEqual([
      [{ id: 1, version: '1' }],
      [{ id: 2, version: '1' }]
    ])
    await act(async () => vi.advanceTimersByTime(3000))
    expect(mocks.put).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
