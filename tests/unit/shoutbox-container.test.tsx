import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn(),
  kunFetchPut: vi.fn(),
  kunFetchDelete: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  setBalance: vi.fn(),
  search: '',
  user: {
    uid: 1,
    name: '我',
    avatar: '',
    moemoepoint: 500,
    moemoepointReserved: 0,
    moemoepointAvailable: 500,
    role: 1
  }
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: mocks.kunFetchPost,
  kunFetchPut: mocks.kunFetchPut,
  kunFetchDelete: mocks.kunFetchDelete
}))

vi.mock('react-hot-toast', () => ({
  default: { success: mocks.toastSuccess, error: mocks.toastError }
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mocks.search)
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}))

vi.mock('~/store/userStore', () => {
  const fullUser = () => ({
    uid: mocks.user.uid,
    name: mocks.user.name,
    avatar: mocks.user.avatar,
    bio: '',
    moemoepoint: mocks.user.moemoepoint,
    moemoepointReserved: mocks.user.moemoepointReserved,
    moemoepointAvailable: mocks.user.moemoepointAvailable,
    role: mocks.user.role,
    dailyCheckIn: 1,
    dailyImageLimit: 0,
    dailyUploadLimit: 0,
    enableEmailNotice: false,
    allowPrivateMessage: true,
    blockedTagIds: [],
    enableRedirect: true,
    excludedDomains: [],
    delaySeconds: 5
  })
  const store = {
    get user() {
      return fullUser()
    },
    setMoemoepointBalance: mocks.setBalance
  }
  const useUserStore = (selector: (state: typeof store) => unknown) =>
    selector(store)
  useUserStore.getState = () => store
  return { useUserStore }
})

vi.mock('@heroui/alert', () => ({
  Alert: ({
    description,
    endContent
  }: {
    description?: React.ReactNode
    endContent?: React.ReactNode
  }) => (
    <div role="alert">
      {description}
      {endContent}
    </div>
  )
}))

vi.mock('@heroui/avatar', () => ({
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
    startContent,
    endContent,
    href,
    'aria-label': ariaLabel
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
    startContent?: React.ReactNode
    endContent?: React.ReactNode
    href?: string
    'aria-label'?: string
  }) =>
    href ? (
      <a href={href}>{children}</a>
    ) : (
      <button
        aria-label={ariaLabel}
        disabled={isDisabled || isLoading}
        onClick={onPress}
      >
        {startContent}
        {children}
        {endContent}
      </button>
    )
}))

vi.mock('@heroui/card', () => ({
  Card: ({
    children,
    id,
    className
  }: {
    children?: React.ReactNode
    id?: string
    className?: string
  }) => (
    <div id={id} className={className}>
      {children}
    </div>
  ),
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@heroui/scroll-shadow', () => ({
  ScrollShadow: ({
    children,
    className,
    ...rest
  }: {
    children?: React.ReactNode
    className?: string
  } & React.HTMLAttributes<HTMLDivElement>) => (
    <div className={className} {...rest}>
      {children}
    </div>
  )
}))

vi.mock('@heroui/spinner', () => ({
  Spinner: ({ label }: { label?: string }) => (
    <div role="status" data-testid="spinner">
      {label}
    </div>
  )
}))

vi.mock('@heroui/tooltip', () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({
    children,
    onClose
  }: {
    children?: React.ReactNode
    onClose?: () => void
  }) => (
    <span>
      {children}
      {onClose ? <button aria-label="移除关联" onClick={onClose} /> : null}
    </span>
  )
}))

vi.mock('@heroui/input', () => ({
  Textarea: ({
    value,
    onValueChange,
    'aria-label': ariaLabel,
    placeholder
  }: {
    value?: string
    onValueChange?: (value: string) => void
    'aria-label'?: string
    placeholder?: string
  }) => (
    <textarea
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onInput={(event) => onValueChange?.(event.currentTarget.value)}
    />
  ),
  Input: ({
    value,
    onValueChange,
    'aria-label': ariaLabel,
    placeholder
  }: {
    value?: string
    onValueChange?: (value: string) => void
    'aria-label'?: string
    placeholder?: string
  }) => (
    <input
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onInput={(event) => onValueChange?.(event.currentTarget.value)}
    />
  )
}))

// The HeroUI v2 Autocomplete is stubbed as an input plus plain option buttons:
// inputValue/onInputChange drive the search, clicking an option reports the
// selection key like the real onSelectionChange.
vi.mock('@heroui/react', () => ({
  Autocomplete: ({
    inputValue,
    onInputChange,
    items,
    onSelectionChange,
    'aria-label': ariaLabel,
    placeholder
  }: {
    inputValue?: string
    onInputChange?: (value: string) => void
    items: Array<{ id: number; name: string; uniqueId: string }>
    onSelectionChange?: (key: React.Key) => void
    'aria-label'?: string
    placeholder?: string
  }) => (
    <div>
      <input
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={inputValue}
        onInput={(event) => onInputChange?.(event.currentTarget.value)}
      />
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelectionChange?.(item.id)}
        >
          {item.name}
        </button>
      ))}
    </div>
  ),
  AutocompleteItem: () => null
}))

vi.mock('@heroui/modal', () => ({
  Modal: ({
    children,
    isOpen
  }: {
    children?: React.ReactNode
    isOpen?: boolean
  }) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  useDisclosure: () => {
    const [isOpen, setIsOpen] = React.useState(false)
    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onClose: () => setIsOpen(false),
      onOpenChange: setIsOpen
    }
  }
}))

vi.mock('~/components/kun/Loading', () => ({
  KunLoading: ({ hint }: { hint: string }) => <div role="status">{hint}</div>
}))

vi.mock('~/components/kun/Null', () => ({
  KunNull: ({ message }: { message: string }) => <div>{message}</div>
}))

vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: ({
    total,
    page,
    onPageChange
  }: {
    total: number
    page: number
    onPageChange: (page: number) => void
  }) => (
    <div>
      <span data-testid="page-indicator">{`${page} / ${total}`}</span>
      <button aria-label="下一页" onClick={() => onPageChange(page + 1)} />
    </div>
  )
}))

// The home module drives its own data hook; tests stub the hook result
// directly while ShoutboxContainer below keeps using the real fetch path.
// Only the home response carries hasMore, so the stub type keeps it optional.
const feedMock = vi.hoisted(() => ({
  result: {
    data: null as
      | (import('~/types/api/shoutbox').ShoutboxListResponse & {
          hasMore?: boolean
        })
      | null,
    loading: false,
    error: '',
    retry: vi.fn()
  }
}))
vi.mock('~/hooks/useShoutboxFeed', () => ({
  useShoutboxFeed: () => feedMock.result
}))

import { ShoutboxContainer } from '~/components/shoutbox/ShoutboxContainer'
import { ShoutboxHomeSection } from '~/components/shoutbox/ShoutboxHomeSection'
import { ShoutboxPatchStrip } from '~/components/shoutbox/ShoutboxPatchStrip'
import { ShoutboxQueryProvider } from '~/components/shoutbox/query/ShoutboxQueryProvider'
import { SHOUTBOX_HOME_LIMIT, SHOUTBOX_PAGE_SIZE } from '~/constants/shoutbox'
import type {
  ShoutboxItem,
  ShoutboxListResponse,
  ShoutboxPublishResponse,
  ShoutboxRequestContext
} from '~/types/api/shoutbox'

const makeItem = (
  id: number,
  overrides: Partial<ShoutboxItem> = {}
): ShoutboxItem => ({
  id,
  user: { id: 100 + id, name: `用户${id}`, avatar: '' },
  content: `消息 ${id}`,
  link: '',
  official: false,
  level: 'normal',
  status: 0,
  cost: 50,
  patch: null,
  effectiveFrom: null,
  effectiveTo: null,
  editedAt: null,
  hiddenAt: null,
  refundedAt: null,
  reportable: true,
  created: new Date(Date.now() - id * 1000).toISOString(),
  updated: new Date(Date.now() - id * 1000).toISOString(),
  ...overrides
})

const makeList = (
  overrides: Partial<ShoutboxListResponse> = {}
): ShoutboxListResponse => ({
  pinned: null,
  shoutboxes: [makeItem(5), makeItem(4), makeItem(3)],
  page: 1,
  totalPages: 2,
  validUntil: new Date(Date.now() + 60_000).toISOString(),
  ...overrides
})

const fillTextarea = async (textarea: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )!.set!
    setter.call(textarea, value)
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

const clickButton = async (container: HTMLElement, label: string) => {
  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button')
  ).find((candidate) => candidate.textContent?.includes(label))
  expect(button, `button ${label}`).not.toBeNull()
  await act(async () => {
    button!.click()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

// The publish modal and the page header share the "发布小喇叭" label; form
// submissions must target the button inside the dialog.
const clickDialogButton = async (container: HTMLElement, label: string) => {
  const dialog = container.querySelector('[role="dialog"]')
  expect(dialog, 'open dialog').not.toBeNull()
  const button = Array.from(
    dialog!.querySelectorAll<HTMLButtonElement>('button')
  ).find((candidate) => candidate.textContent?.includes(label))
  expect(button, `dialog button ${label}`).not.toBeNull()
  await act(async () => {
    button!.click()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

// TanStack notifies observers through setTimeout(0): flush it under fake or
// real timers so cache updates reach the rendered tree.
const flushNotify = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(1)
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  })
}

describe('ShoutboxContainer', () => {
  let dom: JSDOM | undefined
  let root: Root | undefined
  let container: HTMLElement

  const renderContainer = async (
    initialData: ShoutboxListResponse | null,
    patchUniqueId?: string,
    initialContext?: ShoutboxRequestContext
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/shoutbox'
    })
    dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // The request gate only runs while the page is visible.
    Object.defineProperty(dom.window.document, 'visibilityState', {
      value: 'visible',
      configurable: true
    })

    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <ShoutboxQueryProvider>
          <ShoutboxContainer
            initialData={initialData}
            patchUniqueId={patchUniqueId}
            initialContext={initialContext}
          />
        </ShoutboxQueryProvider>
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search = ''
    mocks.user.uid = 1
    mocks.user.role = 1
    mocks.user.moemoepoint = 500
    mocks.user.moemoepointAvailable = 500
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('renders the pinned official message ahead of the ordinary rows', async () => {
    const pinned = makeItem(900, {
      official: true,
      level: 'important',
      cost: 0,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
    })
    const rows = [5, 4, 3, 2, 1].map((id) => makeItem(id))
    mocks.kunFetchGet.mockResolvedValue(makeList({ pinned, shoutboxes: rows }))
    await renderContainer(makeList({ pinned, shoutboxes: rows }))

    const cards = Array.from(container.querySelectorAll('[id^="shoutbox-"]'))
    expect(cards).toHaveLength(6)
    expect(cards[0]?.id).toBe('shoutbox-900')
    // The official badge chip is gone; pinned and level chips stay.
    expect(container.textContent).not.toContain('官方')
    expect(container.textContent).toContain('置顶')
    expect(container.textContent).toContain('重要')
  })

  it('keeps the same requestId after an unknown publish result and applies the authoritative balance on success', async () => {
    mocks.kunFetchGet.mockResolvedValue(makeList())
    mocks.kunFetchPost.mockRejectedValueOnce(new Error('network down'))
    await renderContainer(makeList())

    await clickButton(container, '发布小喇叭')
    await fillTextarea(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="小喇叭正文"]'
      )!,
      '可能已发出的内容'
    )
    await clickDialogButton(container, '发布小喇叭')
    expect(mocks.toastError).toHaveBeenCalledWith(
      '发布结果未知，请稍后重试；重试不会重复扣费'
    )
    expect(mocks.setBalance).not.toHaveBeenCalled()

    const published: ShoutboxPublishResponse = {
      ...makeItem(902, { user: { id: 1, name: '我', avatar: '' } }),
      moemoepointBalance: { total: 450, reserved: 0, available: 450 }
    }
    mocks.kunFetchPost.mockResolvedValueOnce(published)
    await clickDialogButton(container, '发布小喇叭')

    const firstBody = mocks.kunFetchPost.mock.calls[0]?.[1] as {
      requestId: string
      content: string
    }
    const secondBody = mocks.kunFetchPost.mock.calls[1]?.[1] as {
      requestId: string
    }
    expect(firstBody.content).toBe('可能已发出的内容')
    expect(secondBody.requestId).toBe(firstBody.requestId)
    // The balance comes from the publish response verbatim — never computed
    // locally — so a retried request cannot decrement twice.
    expect(mocks.setBalance).toHaveBeenCalledTimes(1)
    expect(mocks.setBalance).toHaveBeenCalledWith({
      total: 450,
      reserved: 0,
      available: 450
    })
    // After publishing, the container returns to page 1 and refetches it.
    const lastListCall = mocks.kunFetchGet.mock.calls.at(-1)
    expect(lastListCall?.[1]).toEqual({ page: 1, limit: SHOUTBOX_PAGE_SIZE })
  })

  it('blocks publishing when the available balance is below the price', async () => {
    mocks.user.moemoepointAvailable = 49
    mocks.kunFetchGet.mockResolvedValue(makeList())
    await renderContainer(makeList())

    await clickButton(container, '发布小喇叭')
    expect(container.textContent).toContain('可用萌萌点不足 50 点')
    const submit = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find(
      (button) =>
        button.textContent?.includes('发布小喇叭') &&
        button.closest('[role="dialog"]')
    )
    expect(submit?.disabled).toBe(true)
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it('highlights only the ?shoutbox=<id> deep link target, never a report id', async () => {
    mocks.search = 'shoutbox=4'
    mocks.kunFetchGet.mockResolvedValue(makeList())
    await renderContainer(makeList())
    expect(container.querySelector('#shoutbox-4')?.className).toContain(
      'ring-2'
    )

    // ?report=<id> is not a message id and must not highlight anything.
    await act(async () => {
      root!.unmount()
    })
    mocks.search = 'report=4'
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    await renderContainer(makeList())
    expect(container.querySelector('#shoutbox-4')?.className).not.toContain(
      'ring-2'
    )
  })

  it('keeps the patch-scoped history at the boundary and refetches once; a failure keeps the rows', async () => {
    vi.useFakeTimers()
    const linked = makeItem(5, {
      patch: {
        id: 100,
        uniqueId: 'abcd1234',
        name: '示例游戏',
        contentLimit: 'sfw'
      }
    })
    const list = makeList({
      shoutboxes: [linked],
      totalPages: 1,
      validUntil: new Date(Date.now() + 30_000).toISOString()
    })
    let resolveRefetch!: (value: unknown) => void
    let rejectRefetch!: (reason?: unknown) => void
    const refetch = new Promise((resolve, reject) => {
      resolveRefetch = resolve
      rejectRefetch = reject
    })
    mocks.kunFetchGet.mockImplementationOnce(() => refetch)

    await renderContainer(list, 'abcd1234')
    expect(container.textContent).toContain('消息 5')
    // A fresh SSR seed needs no mount refetch.
    expect(mocks.kunFetchGet).not.toHaveBeenCalled()

    // Cross the boundary: game messages are public history and stay on
    // screen; exactly one gated refetch starts (TTL and boundary timers
    // merge into the same in-flight request).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(container.textContent).toContain('消息 5')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // A failed refetch keeps the history and surfaces a low-interference
    // notice instead of replacing the list with an error.
    await act(async () => {
      rejectRefetch(new Error('network down'))
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
    expect(container.textContent).toContain('消息 5')
    expect(mocks.toastError).toHaveBeenCalledWith('网络错误，请稍后重试')

    // Patch-scoped views back off by the 300s patch base cache duration, not
    // the 60s global one: no retry at 60s, exactly one at 300s.
    mocks.kunFetchGet.mockImplementationOnce(() =>
      Promise.resolve({
        ...list,
        validUntil: new Date(Date.now() + 300_000).toISOString()
      })
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('消息 5')
  })

  it('never hot-loops on fresh payloads whose validUntil is already past', async () => {
    vi.useFakeTimers()
    // Every response is a fresh object with a newly generated but already
    // expired validUntil (the server's safe-empty fallback shape).
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve(
        makeList({ validUntil: new Date(Date.now() - 1000).toISOString() })
      )
    )
    await renderContainer(null)
    // The first payload is applied (rows visible), the stale pinned logic ran
    // once, and exactly one backoff retry is pending — no immediate refetch.
    expect(container.textContent).toContain('消息 5')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // Global stream: one retry at 60s; the next expired payload schedules
    // exactly one further backoff instead of looping immediately.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain('消息 5')
  })

  it('drops the pinned slot at the boundary even when its own interval still runs, and keeps it gone while the refetch is pending or failed', async () => {
    vi.useFakeTimers()
    const pinnedA = makeItem(900, {
      official: true,
      level: 'important',
      cost: 0,
      content: '置顶公告 A',
      // A is still inside its own effective interval…
      effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
      effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
    })
    // …but the payload's validUntil marks the NEXT official message B
    // starting earlier than A's own end.
    const list = makeList({
      pinned: pinnedA,
      validUntil: new Date(Date.now() + 30_000).toISOString()
    })
    let rejectRefetch!: (reason?: unknown) => void
    const refetch = new Promise((_, reject) => {
      rejectRefetch = reject
    })
    mocks.kunFetchGet.mockImplementationOnce(() => refetch)

    await renderContainer(list)
    expect(container.textContent).toContain('置顶公告 A')
    // A fresh SSR seed needs no mount refetch.
    expect(mocks.kunFetchGet).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    // A must not stay visually pinned while the refresh is pending; ordinary
    // rows stay on screen.
    expect(container.textContent).not.toContain('置顶公告 A')
    expect(container.textContent).toContain('消息 5')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    await act(async () => {
      rejectRefetch(new Error('network down'))
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
    expect(container.textContent).not.toContain('置顶公告 A')
    expect(container.textContent).toContain('消息 5')
    expect(mocks.toastError).toHaveBeenCalledWith('网络错误，请稍后重试')
  })

  const renderHome = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<ShoutboxHomeSection />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('home module renders at most the home limit of rows including the pinned official one', async () => {
    const pinned = makeItem(900, {
      official: true,
      level: 'important',
      cost: 0,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
    })
    // A malformed/future response with a pinned message AND a full page of
    // ordinary rows must still render exactly the home limit of slots.
    feedMock.result = {
      data: makeList({
        pinned,
        shoutboxes: Array.from({ length: SHOUTBOX_HOME_LIMIT }, (_, index) =>
          makeItem(SHOUTBOX_HOME_LIMIT - index)
        ),
        totalPages: 2
      }),
      loading: false,
      error: '',
      retry: vi.fn()
    }

    await renderHome()

    // One author link per rendered row: the pinned official message first,
    // then ordinary rows capped so the total never exceeds the home limit.
    const authorLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href^="/user/"]')
    ).map((link) => link.getAttribute('href'))
    expect(authorLinks).toHaveLength(SHOUTBOX_HOME_LIMIT)
    expect(authorLinks[0]).toBe(`/user/${100 + 900}`)
    // The 15th ordinary row (user 101) is cut to make room for the pin.
    expect(authorLinks).toContain(`/user/${100 + SHOUTBOX_HOME_LIMIT}`)
    expect(authorLinks).not.toContain('/user/101')
  })

  it('home renders the "show more" entry as the scroll region\'s last item when the feed reports a 16th+ public record', async () => {
    feedMock.result = {
      data: { ...makeList(), hasMore: true },
      loading: false,
      error: '',
      retry: vi.fn()
    }
    await renderHome()

    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    const entry = region!.querySelector('a[href="/shoutbox"]')
    expect(entry?.textContent).toContain('显示更多')
    // The entry is the scroll region's last item and exists nowhere else:
    // it only appears after scrolling to the end, never as a fixed footer.
    expect(region!.lastElementChild?.contains(entry)).toBe(true)
    expect(container.querySelectorAll('a[href="/shoutbox"]')).toHaveLength(1)
  })

  it('home keeps the "show more" footer unmounted when no further record exists or the field is missing', async () => {
    feedMock.result = {
      data: { ...makeList(), hasMore: false },
      loading: false,
      error: '',
      retry: vi.fn()
    }
    await renderHome()
    expect(container.querySelector('a[href="/shoutbox"]')).toBeNull()

    // A legacy response without the field counts as "no more".
    await act(async () => {
      root!.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    feedMock.result = {
      data: makeList(),
      loading: false,
      error: '',
      retry: vi.fn()
    }
    await renderHome()
    expect(container.querySelector('a[href="/shoutbox"]')).toBeNull()
  })

  it('home lets the author edit their own message in place (no delete entry); the write path owns the cache refresh', async () => {
    const own = makeItem(5, {
      user: { id: 1, name: '我', avatar: '' },
      content: '自己的消息',
      created: new Date().toISOString()
    })
    feedMock.result = {
      data: makeList({ shoutboxes: [own] }),
      loading: false,
      error: '',
      retry: vi.fn()
    }
    await renderHome()

    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="编辑"]'
    )
    expect(editButton).not.toBeNull()
    // The home module must not gain a delete entry.
    expect(container.querySelector('button[aria-label="删除"]')).toBeNull()

    await act(async () => {
      editButton!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await fillTextarea(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="编辑小喇叭"]'
      )!,
      '改过的内容'
    )
    mocks.kunFetchPut.mockResolvedValue(
      makeItem(5, {
        user: { id: 1, name: '我', avatar: '' },
        content: '改过的内容',
        editedAt: new Date().toISOString()
      })
    )
    await clickButton(container, '保存')

    expect(mocks.kunFetchPut).toHaveBeenCalledWith('/shoutbox', {
      shoutboxId: 5,
      content: '改过的内容'
    })
    // No parent-level force retry: the card's write notification invalidates
    // and refetches the observed public key exactly once (covered in the
    // query-level tests with a real provider; this home harness stubs the
    // feed hook, so the notification is a null-context no-op here).
    expect(feedMock.result.retry).not.toHaveBeenCalled()
  })

  it('home publish normalizes manual newlines before sending', async () => {
    feedMock.result = {
      data: makeList(),
      loading: false,
      error: '',
      retry: vi.fn()
    }
    const published: ShoutboxPublishResponse = {
      ...makeItem(903, { user: { id: 1, name: '我', avatar: '' } }),
      moemoepointBalance: { total: 450, reserved: 0, available: 450 }
    }
    mocks.kunFetchPost.mockResolvedValueOnce(published)

    await renderHome()
    await clickButton(container, '发布小喇叭')
    await fillTextarea(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="小喇叭正文"]'
      )!,
      '第一行\n第二行'
    )
    await clickDialogButton(container, '发布小喇叭')

    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/shoutbox',
      expect.objectContaining({ content: '第一行 第二行' })
    )
  })

  it('home publish opens the shared form for a logged-in user and closes on success without a duplicate refresh', async () => {
    feedMock.result = {
      data: makeList(),
      loading: false,
      error: '',
      retry: vi.fn()
    }
    const published: ShoutboxPublishResponse = {
      ...makeItem(902, { user: { id: 1, name: '我', avatar: '' } }),
      moemoepointBalance: { total: 450, reserved: 0, available: 450 }
    }
    mocks.kunFetchPost.mockResolvedValueOnce(published)

    await renderHome()
    await clickButton(container, '发布小喇叭')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    await fillTextarea(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="小喇叭正文"]'
      )!,
      '首页发出的小喇叭'
    )
    await clickDialogButton(container, '发布小喇叭')

    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('小喇叭已发布')
    // The write notification owns the public-cache refresh; the parent only
    // closes the modal (no second force fetch of the same key).
    expect(feedMock.result.retry).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('home publish shows the login prompt to guests instead of the form', async () => {
    mocks.user.uid = 0
    feedMock.result = {
      data: makeList(),
      loading: false,
      error: '',
      retry: vi.fn()
    }

    await renderHome()
    await clickButton(container, '发布小喇叭')

    expect(container.textContent).toContain('发布小喇叭需要先登录账号')
    expect(
      container.querySelector('textarea[aria-label="小喇叭正文"]')
    ).toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
  })

  it('keeps the official entry out of the home card and shows it inside the publish dialog to administrators only', async () => {
    mocks.user.role = 3
    feedMock.result = {
      data: makeList(),
      loading: false,
      error: '',
      retry: vi.fn()
    }

    await renderHome()
    const officialLinks = () =>
      Array.from(
        container.querySelectorAll<HTMLAnchorElement>(
          'a[href="/dashboard/shoutbox?tab=official"]'
        )
      )
    // The home card itself carries no official explanation or entry.
    expect(officialLinks()).toHaveLength(0)

    // Opening the shared publish UI reveals the official entry to admins.
    await clickButton(container, '发布小喇叭')
    const dialog = container.querySelector('[role="dialog"]')
    expect(
      dialog?.querySelector('a[href="/dashboard/shoutbox?tab=official"]')
    ).not.toBeNull()

    await act(async () => {
      root!.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    mocks.user.role = 1
    await renderHome()
    await clickButton(container, '发布小喇叭')
    expect(officialLinks()).toHaveLength(0)
  })

  it('patch strip uses the approved title and links to the per-game view', async () => {
    const linked = makeItem(5, {
      patch: {
        id: 100,
        uniqueId: 'abcd1234',
        name: '示例游戏',
        contentLimit: 'sfw'
      }
    })
    feedMock.result = {
      data: makeList({ shoutboxes: [linked], totalPages: 1 }),
      loading: false,
      error: '',
      retry: vi.fn()
    }

    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/abcd1234'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<ShoutboxPatchStrip patchUniqueId="abcd1234" />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('关于本作的小喇叭')
    expect(
      container.querySelector('a[href="/shoutbox?patch=abcd1234"]')
    ).not.toBeNull()
    expect(container.textContent).toContain('消息 5')
  })
  it('merges automatic refreshes and preserves a slow response until its real boundary', async () => {
    vi.useFakeTimers()
    const payload = makeList({
      pinned: makeItem(900, { official: true }),
      validUntil: new Date(Date.now() + 1000).toISOString(),
      visibilityUntil: new Date(Date.now() + 2000).toISOString()
    })
    let resolveFirst!: (value: ShoutboxListResponse) => void
    mocks.kunFetchGet
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValue('暂时失败')
    await renderContainer(payload)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    // The TTL timer started exactly one background refresh; the seeded
    // payload stays on screen while it is in flight.
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    expect(container.querySelector('#shoutbox-900')).not.toBeNull()
    await act(async () => {
      resolveFirst(payload)
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
    expect(container.querySelector('#shoutbox-900')).not.toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    // The real boundary hides the pinned slot on time. The refreshed payload
    // was already expired on arrival (validUntil < its receive time), so the
    // next fetch waits out the 60s arrival backoff instead of firing here.
    expect(container.querySelector('#shoutbox-900')).toBeNull()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
  })

  it('SSR seed with a matching fresh context mounts with zero GETs', async () => {
    await renderContainer(makeList(), undefined, {
      uid: 1,
      nsfw: 'sfw',
      blockedTags: []
    })
    expect(container.textContent).toContain('消息 5')
    expect(mocks.kunFetchGet).not.toHaveBeenCalled()
  })

  it('SSR/API context mismatch keeps the same user the SSR text with game links cleared, then replaces it with one fresh read', async () => {
    const linked = makeItem(5, {
      patch: {
        id: 100,
        uniqueId: 'abcd1234',
        name: '示例游戏',
        contentLimit: 'sfw'
      }
    })
    const pinned = makeItem(900, {
      official: true,
      level: 'important',
      cost: 0,
      content: '置顶公告 A',
      patch: {
        id: 100,
        uniqueId: 'abcd1234',
        name: '示例游戏',
        contentLimit: 'sfw'
      },
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
    })
    let resolveRead!: (value: ShoutboxListResponse) => void
    mocks.kunFetchGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        })
    )
    // SSR ran with nsfw=all; the API context resolves to sfw — same uid.
    await renderContainer(
      makeList({ pinned, shoutboxes: [linked] }),
      undefined,
      {
        uid: 1,
        nsfw: 'all',
        blockedTags: []
      }
    )

    // Handoff placeholder while the first API read is in flight: text stays,
    // every game association is cleared, and exactly one read goes out.
    expect(container.textContent).toContain('消息 5')
    expect(container.textContent).toContain('置顶公告 A')
    expect(container.textContent).not.toContain('示例游戏')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRead(makeList({ shoutboxes: [makeItem(8)] }))
      await Promise.resolve()
    })
    await flushNotify()
    expect(container.textContent).toContain('消息 8')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
  })

  it('a different uid gets no handoff text and simply loads its own scope', async () => {
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve(makeList({ shoutboxes: [makeItem(8)] }))
    )
    await renderContainer(makeList(), undefined, {
      uid: 5,
      nsfw: 'sfw',
      blockedTags: []
    })
    expect(container.textContent).not.toContain('消息 5')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    await flushNotify()
    expect(container.textContent).toContain('消息 8')
  })

  it('an expired SSR seed refetches immediately instead of backing off like a stale arrival', async () => {
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve(makeList({ shoutboxes: [makeItem(8)] }))
    )
    await renderContainer(
      makeList({ validUntil: new Date(Date.now() - 1000).toISOString() }),
      undefined,
      { uid: 1, nsfw: 'sfw', blockedTags: [] }
    )
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    await flushNotify()
    expect(container.textContent).toContain('消息 8')
  })

  it('drops the handoff pin at its real boundary even while the first API read sits in error cooldown', async () => {
    vi.useFakeTimers()
    const pinned = makeItem(900, {
      official: true,
      level: 'important',
      cost: 0,
      content: '置顶公告 A',
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
    })
    const seed = makeList({
      pinned,
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      visibilityUntil: new Date(Date.now() + 30_000).toISOString()
    })
    let rejectFirst!: (reason?: unknown) => void
    mocks.kunFetchGet.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject
        })
    )
    await renderContainer(seed, undefined, {
      uid: 1,
      nsfw: 'all',
      blockedTags: []
    })
    expect(container.textContent).toContain('置顶公告 A')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // The first API read fails at T+10s: error state with a visible retry,
    // the handoff text stays, and the 60s cooldown starts.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    await act(async () => {
      rejectFirst(new Error('network down'))
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushNotify()
    expect(container.textContent).toContain('置顶公告 A')
    expect(container.textContent).toContain('重试')

    // T+30s: the real boundary drops the handoff pin on time — no new GET
    // while the error cooldown runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(container.textContent).not.toContain('置顶公告 A')
    expect(container.textContent).toContain('消息 5')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    // Still nothing before the cooldown ends; the retry fires at T+70s.
    mocks.kunFetchGet.mockImplementation(() =>
      Promise.resolve(makeList({ shoutboxes: [makeItem(8)] }))
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    await flushNotify()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('消息 8')
  })
})
