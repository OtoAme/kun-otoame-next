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
  )
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
const feedMock = vi.hoisted(() => ({
  result: {
    data: null as import('~/types/api/shoutbox').ShoutboxListResponse | null,
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
import type {
  ShoutboxItem,
  ShoutboxListResponse,
  ShoutboxPublishResponse
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

describe('ShoutboxContainer', () => {
  let dom: JSDOM | undefined
  let root: Root | undefined
  let container: HTMLElement

  const renderContainer = async (
    initialData: ShoutboxListResponse | null,
    patchUniqueId?: string
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/shoutbox'
    })
    dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <ShoutboxContainer
          initialData={initialData}
          patchUniqueId={patchUniqueId}
        />
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search = ''
    mocks.user.uid = 1
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

  it('renders the pinned official message as the first of six slots', async () => {
    const pinned = makeItem(900, {
      official: true,
      level: 'important',
      cost: 0,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
    })
    const rows = [5, 4, 3, 2, 1].map((id) => makeItem(id))
    mocks.kunFetchGet.mockResolvedValue(
      makeList({ pinned, shoutboxes: rows })
    )
    await renderContainer(makeList({ pinned, shoutboxes: rows }))

    const cards = Array.from(
      container.querySelectorAll('[id^="shoutbox-"]')
    )
    expect(cards).toHaveLength(6)
    expect(cards[0]?.id).toBe('shoutbox-900')
    expect(container.textContent).toContain('官方')
    expect(container.textContent).toContain('置顶')
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
    expect(lastListCall?.[1]).toEqual({ page: 1, limit: 6 })
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

  it('drops the whole patch-scoped payload before refetching at the boundary', async () => {
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
    mocks.kunFetchGet.mockResolvedValueOnce(list)
    let resolveRefetch!: (value: unknown) => void
    let rejectRefetch!: (reason?: unknown) => void
    const refetch = new Promise((resolve, reject) => {
      resolveRefetch = resolve
      rejectRefetch = reject
    })
    mocks.kunFetchGet.mockImplementationOnce(() => refetch)

    await renderContainer(list, 'abcd1234')
    expect(container.textContent).toContain('消息 5')

    // Cross the boundary: every patch-scoped row disappears BEFORE the
    // refetch resolves — retention-only rows must not linger.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(container.textContent).not.toContain('消息 5')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    // A failed refetch keeps the safe empty state instead of reviving the
    // expired payload.
    await act(async () => {
      rejectRefetch(new Error('network down'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('消息 5')
    expect(container.textContent).toContain('网络错误，请稍后重试')

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
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000)
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(3)
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
    mocks.kunFetchGet.mockResolvedValueOnce(list)
    let resolveRefetch!: (value: unknown) => void
    let rejectRefetch!: (reason?: unknown) => void
    const refetch = new Promise((resolve, reject) => {
      resolveRefetch = resolve
      rejectRefetch = reject
    })
    mocks.kunFetchGet.mockImplementationOnce(() => refetch)

    await renderContainer(list)
    expect(container.textContent).toContain('置顶公告 A')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    // A must not stay visually pinned while the refresh is pending; ordinary
    // rows stay on screen.
    expect(container.textContent).not.toContain('置顶公告 A')
    expect(container.textContent).toContain('消息 5')
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    await act(async () => {
      rejectRefetch(new Error('network down'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('置顶公告 A')
    expect(container.textContent).toContain('消息 5')
    expect(container.textContent).toContain('网络错误，请稍后重试')
  })

  it('home module renders at most six rows including the pinned official one', async () => {
    const pinned = makeItem(900, {
      official: true,
      level: 'important',
      cost: 0,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      effectiveTo: new Date(Date.now() + 3_600_000).toISOString()
    })
    // A malformed/future response with a pinned message AND six ordinary
    // rows must still render exactly six slots.
    feedMock.result = {
      data: makeList({
        pinned,
        shoutboxes: [6, 5, 4, 3, 2, 1].map((id) => makeItem(id)),
        totalPages: 2
      }),
      loading: false,
      error: '',
      retry: vi.fn()
    }

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
    })

    const text = container.textContent ?? ''
    const rendered = Array.from(text.matchAll(/消息 (\d+)/g)).map(
      (match) => match[1]
    )
    expect(rendered).toEqual(['900', '6', '5', '4', '3', '2'])
    expect(text.indexOf('消息 900')).toBeLessThan(text.indexOf('消息 6'))
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
})
