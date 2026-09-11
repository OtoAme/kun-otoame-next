import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseInboxReturn } from '~/hooks/dashboard/useInbox'
import type { InboxItem } from '~/types/api/inbox'

const mocks = vi.hoisted(() => ({
  useInbox: vi.fn(),
  refreshCounts: vi.fn(),
  isMobile: false,
  positive: vi.fn(),
  destructive: vi.fn(),
  positiveDisabled: false,
  destructiveDisabled: false
}))
vi.mock('~/hooks/dashboard/useInbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/hooks/dashboard/useInbox')>()),
  useInbox: mocks.useInbox
}))
vi.mock('~/hooks/dashboard/use-mobile', () => ({
  useIsMobile: () => mocks.isMobile
}))
vi.mock('~/components/dashboard/DashboardShell', () => ({
  useDashboard: () => ({
    refreshCounts: mocks.refreshCounts
  })
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn()
}))
vi.mock('~/components/dashboard/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => null
}))
vi.mock('~/components/dashboard/ui/input', () => ({
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={(event) =>
        onChange?.(event as React.ChangeEvent<HTMLInputElement>)
      }
    />
  )
}))
vi.mock('~/components/dashboard/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: React.ComponentProps<'input'> & {
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      readOnly
      onClick={() => onCheckedChange?.(!checked)}
    />
  )
}))
vi.mock('~/components/dashboard/ui/select', () => ({
  Select: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
  SelectValue: () => <span>排序方式</span>,
  SelectContent: () => null,
  SelectItem: () => null
}))
vi.mock('~/components/dashboard/ui/dialog', async () => {
  const ReactModule = await import('react')
  const Context = ReactModule.createContext({
    open: false,
    onOpenChange: (_open: boolean) => {}
  })
  const Block = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Dialog: ({
      open,
      onOpenChange,
      children
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      children?: React.ReactNode
    }) => (
      <Context.Provider value={{ open, onOpenChange }}>
        {children}
      </Context.Provider>
    ),
    DialogContent: ({ children }: { children?: React.ReactNode }) => {
      const { open } = ReactModule.useContext(Context)
      return open ? <div role="dialog">{children}</div> : null
    },
    DialogTrigger: ({
      children
    }: {
      children: React.ReactElement<{ onClick?: () => void }>
    }) => {
      const { onOpenChange } = ReactModule.useContext(Context)
      return ReactModule.cloneElement(children, {
        onClick: () => onOpenChange(true)
      })
    },
    DialogClose: ({
      children
    }: {
      children: React.ReactElement<{ onClick?: () => void }>
    }) => {
      const { onOpenChange } = ReactModule.useContext(Context)
      return ReactModule.cloneElement(children, {
        onClick: () => onOpenChange(false)
      })
    },
    DialogHeader: Block,
    DialogTitle: Block,
    DialogDescription: Block,
    DialogFooter: Block
  }
})

function MockWritableDetail({ item }: { item: InboxItem }) {
  return (
    <section aria-label={`${item.kind}详情`}>
      <p>{item.title}的完整详情</p>
      <button
        data-inbox-action="positive"
        disabled={mocks.positiveDisabled}
        onClick={() => mocks.positive(item.key)}
      >
        模拟通过
      </button>
      <button
        data-inbox-action="destructive"
        disabled={mocks.destructiveDisabled}
        onClick={() => mocks.destructive(item.key)}
      >
        模拟拒绝
      </button>
    </section>
  )
}
vi.mock('~/components/dashboard/inbox/SubmissionInboxDetail', () => ({
  SubmissionInboxDetail: MockWritableDetail
}))
vi.mock('~/components/dashboard/inbox/ResourceInboxDetail', () => ({
  ResourceInboxDetail: MockWritableDetail
}))
vi.mock('~/components/dashboard/inbox/LegacyInboxDetail', () => ({
  LegacyInboxDetail: ({ item }: { item: InboxItem }) => (
    <section aria-label={`${item.kind}详情`}>
      <p>{item.title}的只读详情</p>
      <a href={item.targetHref}>旧后台处理</a>
    </section>
  )
}))

import { DashboardInbox } from '~/components/dashboard/DashboardInbox'

const submission = (
  id: number,
  waitingSeconds = 60
): Extract<InboxItem, { kind: 'submission' }> => ({
  key: `submission:${id}`,
  kind: 'submission',
  id,
  title: `待审条目 ${id}`,
  subtitle: '投稿人',
  actor: { id: 7, name: '投稿人' },
  waitingFrom: '2026-09-01T00:00:00.000Z',
  waitingSeconds,
  targetHref: `/admin/submission/${id}`,
  badges: [],
  readOnly: false,
  payload: {
    id,
    status: 'pending',
    name: `待审条目 ${id}`,
    authorName: '投稿人',
    authorId: 7,
    submittedAt: '2026-09-01T00:00:00.000Z',
    reviewedAt: null,
    updated: '2026-09-01T00:00:00.000Z',
    created: '2026-09-01T00:00:00.000Z'
  }
})
const feedback: Extract<InboxItem, { kind: 'feedback' }> = {
  key: 'feedback:8',
  kind: 'feedback',
  id: 8,
  title: '旧反馈',
  subtitle: '反馈人',
  actor: { id: 7, name: '反馈人' },
  waitingFrom: '2026-09-01T00:00:00.000Z',
  waitingSeconds: 90,
  targetHref: '/admin/feedback',
  badges: [],
  readOnly: true,
  payload: {
    id: 8,
    type: 'feedback',
    content: '反馈内容',
    status: 0,
    link: '/',
    created: '2026-09-01T00:00:00.000Z',
    sender: { id: 7, name: '反馈人', avatar: '' }
  }
}

describe('dashboard inbox presentation', () => {
  let dom: JSDOM
  let root: Root
  let state: UseInboxReturn

  beforeEach(() => {
    vi.resetAllMocks()
    mocks.isMobile = false
    mocks.positiveDisabled = false
    mocks.destructiveDisabled = false
    const rows = [submission(3, 60), submission(1, 300), submission(2, 120)]
    state = {
      kinds: ['submission'],
      search: '',
      order: 'waiting',
      submissionOnly: true,
      submissionStatus: 'pending',
      submissionPage: 1,
      historyMode: false,
      setSubmissionStatus: vi.fn(),
      setSubmissionPage: vi.fn(),
      selectionStatus: 'none',
      selection: null,
      selectedKey: null,
      items: rows,
      totals: { submission: 3, 'resource-apply': 0, feedback: 0, report: 0 },
      truncated: {
        submission: false,
        'resource-apply': false,
        feedback: false,
        report: false
      },
      listLoading: false,
      listError: '',
      item: null,
      itemLoading: false,
      itemError: '',
      refreshing: false,
      itemsRef: { current: rows },
      selectItem: vi.fn(),
      clearSelection: vi.fn(),
      toggleKind: vi.fn(),
      setOrder: vi.fn(),
      submitSearch: vi.fn(),
      retryList: vi.fn(),
      retryItem: vi.fn(),
      refreshAll: vi.fn().mockResolvedValue(undefined),
      onProcessed: vi.fn(),
      onStateChanged: vi.fn().mockResolvedValue(undefined)
    }
    mocks.useInbox.mockImplementation(() => state)
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'https://example.com/dashboard'
    })
    dom.window.HTMLElement.prototype.scrollIntoView = vi.fn()
    dom.window.HTMLElement.prototype.scrollTo = vi.fn()
    Object.defineProperties(dom.window.HTMLElement.prototype, {
      attachEvent: { configurable: true, value: () => {} },
      detachEvent: { configurable: true, value: () => {} }
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = dom.window.document.getElementById('root')!
    container.setAttribute('data-dashboard-scroll', '')
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })
  const render = async (overrides: Partial<UseInboxReturn> = {}) => {
    state = { ...state, ...overrides }
    state.itemsRef.current = state.items
    await act(async () => {
      root.render(<DashboardInbox reviewerId={9} reviewerRole={3} />)
    })
  }
  const select = async (
    selected = submission(1),
    overrides: Partial<UseInboxReturn> = {}
  ) => {
    await render({
      selectionStatus: 'ok',
      selectedKey: selected.key,
      selection: { kind: selected.kind, id: selected.id },
      item: { key: selected.key, data: { state: 'pending', item: selected } },
      ...overrides
    })
  }
  const bodyText = () => dom.window.document.body.textContent ?? ''
  const rowKeys = () =>
    [...dom.window.document.querySelectorAll('[data-inbox-row-key]')].map(
      (row) => row.getAttribute('data-inbox-row-key')
    )
  const button = (label: string) => {
    const found = [...dom.window.document.querySelectorAll('button')].find(
      (element) => element.textContent?.trim() === label
    )
    expect(found, label).toBeDefined()
    return found!
  }
  const press = async (
    key: string,
    target: HTMLElement = dom.window.document.body,
    init: KeyboardEventInit = {}
  ) => {
    const event = new dom.window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...init
    })
    await act(async () => {
      target.dispatchEvent(event)
    })
    return event
  }

  it('keeps the server row order and displays only filtered totals and selected-source truncation', async () => {
    await render({
      search: '匹配作者',
      totals: { submission: 80, 'resource-apply': 0, feedback: 999, report: 0 },
      truncated: {
        submission: true,
        'resource-apply': false,
        feedback: true,
        report: false
      }
    })
    expect(rowKeys()).toEqual(['submission:3', 'submission:1', 'submission:2'])
    expect(bodyText()).toContain('已显示 3 / 80 条')
    expect(bodyText()).toContain('待审条目：该来源还有更多，先处理这些')
    expect(bodyText()).not.toContain('旧反馈：该来源还有更多')
  })

  it('renders an outside-window selected detail without inserting or selecting a candidate row', async () => {
    await select(submission(99))
    expect(rowKeys()).toEqual(['submission:3', 'submission:1', 'submission:2'])
    expect(
      dom.window.document.querySelector('[aria-current="true"]')
    ).toBeNull()
    expect(bodyText()).toContain('待审条目 99的完整详情')
    expect(bodyText()).toContain('已显示 3 / 3 条')
  })

  it('submits search explicitly instead of on each input and syncs input after URL navigation', async () => {
    await render({ search: '起始搜索' })
    const input = dom.window.document.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )!
    await act(async () => {
      input.value = '新的搜索'
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    expect(state.submitSearch).not.toHaveBeenCalled()
    await act(async () => {
      button('搜索').click()
    })
    expect(state.submitSearch).toHaveBeenCalledExactlyOnceWith('新的搜索')
    await render({ search: '浏览器返回的搜索' })
    expect(input.value).toBe('浏览器返回的搜索')
    expect(state.submitSearch).toHaveBeenCalledOnce()
  })

  it.each([
    ['none', '从左侧列表选择'],
    ['invalid', '事项链接无效']
  ] as const)(
    'shows the %s selection state without review actions',
    async (selectionStatus, message) => {
      await render({ selectionStatus })
      expect(bodyText()).toContain(message)
      expect(
        dom.window.document.querySelector('[data-inbox-action]')
      ).toBeNull()
    }
  )

  it('shows a detail loading state while no response is available', async () => {
    await select(submission(1), { item: null, itemLoading: true })
    expect(
      dom.window.document.querySelector(
        '[role="status"][aria-label="正在加载事项详情"]'
      )
    ).not.toBeNull()
    expect(dom.window.document.querySelector('[data-inbox-action]')).toBeNull()
  })

  it('opens the existing submission detail for a processed history record', async () => {
    const selected = submission(1)
    await select(selected, {
      historyMode: true,
      submissionOnly: true,
      submissionStatus: 'published',
      item: { key: selected.key, data: { state: 'processed', item: selected } }
    })
    expect(bodyText()).toContain(`${selected.title}的完整详情`)
    expect(bodyText()).not.toContain('该事项已被处理')
  })

  it.each(['missing', 'processed'] as const)(
    'shows the %s item state and offers refresh and return actions',
    async (status) => {
      const selected = submission(1)
      await select(selected, {
        item: {
          key: selected.key,
          data:
            status === 'missing'
              ? { state: 'missing', item: null }
              : { state: 'processed', item: selected }
        }
      })
      expect(bodyText()).toContain(
        status === 'missing' ? '该事项已不存在' : '该事项已被处理'
      )
      expect(
        dom.window.document.querySelector('[data-inbox-action]')
      ).toBeNull()
      await act(async () => {
        button('刷新列表').click()
        button('返回列表').click()
      })
      expect(state.refreshAll).toHaveBeenCalledOnce()
      expect(state.clearSelection).toHaveBeenCalledOnce()
    }
  )

  it('does not render an old detail whose key differs from the current selection', async () => {
    await select(submission(2), {
      item: {
        key: 'submission:1',
        data: { state: 'pending', item: submission(1) }
      }
    })
    expect(bodyText()).not.toContain('待审条目 1的完整详情')
    expect(dom.window.document.querySelector('[data-inbox-action]')).toBeNull()
  })

  it('shows retryable item errors even when a same-key pending item was retained by the hook', async () => {
    await select(submission(1), {
      itemError: '409 后刷新失败',
      itemLoading: false
    })
    expect(bodyText()).toContain('409 后刷新失败')
    expect(dom.window.document.querySelector('[data-inbox-action]')).toBeNull()
    await act(async () => {
      button('重试').click()
    })
    expect(state.retryItem).toHaveBeenCalledOnce()
  })

  it('hides old review actions while a retained same-key item is being refreshed', async () => {
    await select(submission(1), { itemLoading: true })
    expect(
      dom.window.document.querySelector(
        '[role="status"][aria-label="正在加载事项详情"]'
      )
    ).not.toBeNull()
    expect(dom.window.document.querySelector('[data-inbox-action]')).toBeNull()
  })

  it('does not hide the current request error behind an old mismatched item', async () => {
    await select(submission(2), {
      itemError: '当前事项加载失败',
      itemLoading: false,
      item: {
        key: 'submission:1',
        data: { state: 'pending', item: submission(1) }
      }
    })
    expect(bodyText()).toContain('当前事项加载失败')
    expect(dom.window.document.querySelector('[data-inbox-action]')).toBeNull()
  })

  it('dispatches A and D only to the currently selected pending writable detail', async () => {
    await select(submission(2))
    await press('a')
    await press('d')
    expect(mocks.positive).toHaveBeenCalledExactlyOnceWith('submission:2')
    expect(mocks.destructive).toHaveBeenCalledExactlyOnceWith('submission:2')
  })

  it('ignores held-down auto-repeat for review actions but fires once per real press', async () => {
    await select(submission(2))
    await press('a', undefined, { repeat: true })
    await press('d', undefined, { repeat: true })
    expect(mocks.positive).not.toHaveBeenCalled()
    expect(mocks.destructive).not.toHaveBeenCalled()
    await press('a')
    await press('d')
    expect(mocks.positive).toHaveBeenCalledExactlyOnceWith('submission:2')
    expect(mocks.destructive).toHaveBeenCalledExactlyOnceWith('submission:2')
  })

  it.each(['loading', 'error'] as const)(
    'does not dispatch review shortcuts during item %s recovery',
    async (phase) => {
      await select(
        submission(1),
        phase === 'loading' ? { itemLoading: true } : { itemError: '请重试' }
      )
      await press('a')
      await press('d')
      expect(mocks.positive).not.toHaveBeenCalled()
      expect(mocks.destructive).not.toHaveBeenCalled()
    }
  )

  it('does not dispatch review shortcuts for a read-only source', async () => {
    await render({
      kinds: ['feedback'],
      items: [feedback],
      selectionStatus: 'ok',
      selection: { kind: 'feedback', id: 8 },
      selectedKey: feedback.key,
      item: { key: feedback.key, data: { state: 'pending', item: feedback } }
    })
    expect(bodyText()).toContain('旧反馈的只读详情')
    expect(bodyText()).toContain('旧，去旧后台处理')
    await press('a')
    await press('d')
    expect(mocks.positive).not.toHaveBeenCalled()
    expect(mocks.destructive).not.toHaveBeenCalled()
  })

  it('respects disabled action controls when keyboard shortcuts are used', async () => {
    mocks.positiveDisabled = true
    mocks.destructiveDisabled = true
    await select(submission(1))
    await press('a')
    await press('d')
    expect(mocks.positive).not.toHaveBeenCalled()
    expect(mocks.destructive).not.toHaveBeenCalled()
  })

  it.each(['input', 'textarea', 'select'])(
    'leaves typing and cursor navigation inside %s controls alone',
    async (tag) => {
      await select(submission(1))
      const target = dom.window.document.createElement(tag)
      dom.window.document.body.append(target)
      await press('a', target)
      await press('d', target)
      await press('ArrowDown', target)
      expect(mocks.positive).not.toHaveBeenCalled()
      expect(mocks.destructive).not.toHaveBeenCalled()
      expect(state.selectItem).not.toHaveBeenCalled()
    }
  )

  it.each(['dialog', 'alertdialog', 'menu', 'listbox'])(
    'does not run inbox shortcuts while a %s is open',
    async (role) => {
      await select(submission(1))
      const overlay = dom.window.document.createElement('div')
      overlay.setAttribute('role', role)
      dom.window.document.body.append(overlay)
      await press('a')
      await press('d')
      await press('ArrowDown')
      expect(mocks.positive).not.toHaveBeenCalled()
      expect(mocks.destructive).not.toHaveBeenCalled()
      expect(state.selectItem).not.toHaveBeenCalled()
    }
  )

  it.each(['contenteditable', 'combobox'] as const)(
    'keeps shortcuts from interfering with a %s editing region',
    async (region) => {
      await select(submission(1))
      const target = dom.window.document.createElement('div')
      if (region === 'contenteditable') {
        target.setAttribute('contenteditable', 'true')
        Object.defineProperty(target, 'isContentEditable', { value: true })
      } else {
        target.setAttribute('role', 'combobox')
      }
      dom.window.document.body.append(target)
      await press('a', target)
      await press('d', target)
      await press('ArrowDown', target)
      expect(mocks.positive).not.toHaveBeenCalled()
      expect(mocks.destructive).not.toHaveBeenCalled()
      expect(state.selectItem).not.toHaveBeenCalled()
    }
  )

  it('ignores review shortcuts during IME composition and modifier-key combinations', async () => {
    await select(submission(1))
    await press('a', undefined, { isComposing: true })
    await press('a', undefined, { ctrlKey: true })
    await press('d', undefined, { metaKey: true })
    expect(mocks.positive).not.toHaveBeenCalled()
    expect(mocks.destructive).not.toHaveBeenCalled()
  })

  it('moves up and down in displayed server order and starts at an edge for an outside-window selection', async () => {
    await select(submission(1))
    await press('ArrowDown')
    expect(state.selectItem).toHaveBeenLastCalledWith(state.items[2])
    await press('ArrowUp')
    expect(state.selectItem).toHaveBeenLastCalledWith(state.items[0])
    await select(submission(99))
    await press('ArrowDown')
    expect(state.selectItem).toHaveBeenLastCalledWith(state.items[0])
    await press('ArrowUp')
    expect(state.selectItem).toHaveBeenLastCalledWith(state.items[2])
  })

  it('focuses search with slash and opens help without triggering a review', async () => {
    await select(submission(1))
    await press('/')
    expect(dom.window.document.activeElement).toBe(
      dom.window.document.querySelector('input[type="search"]')
    )
    await press('?')
    expect(dom.window.document.querySelector('[role="dialog"]')).not.toBeNull()
    await press('a')
    expect(mocks.positive).not.toHaveBeenCalled()
  })

  it('starts each selected mobile item at the top of the shared page', async () => {
    mocks.isMobile = true
    await select(submission(1))
    const scroller = document.getElementById('root')!
    vi.mocked(scroller.scrollTo).mockClear()
    await select(submission(2))
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it('returns to the top of the shared page for an invalid mobile deep link', async () => {
    mocks.isMobile = true
    await select(submission(1))
    const scroller = document.getElementById('root')!
    vi.mocked(scroller.scrollTo).mockClear()
    await render({
      selectionStatus: 'invalid',
      selectedKey: null,
      selection: null
    })
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0 })
    expect(bodyText()).toContain('事项链接无效')
  })

  it('returns from mobile detail to the candidate list without clearing the active search', async () => {
    mocks.isMobile = true
    await select(submission(1), { search: '作者搜索' })
    expect(rowKeys()).toEqual([])
    expect(bodyText()).toContain('待审条目 1的完整详情')
    await act(async () => {
      button('返回列表').click()
    })
    expect(state.clearSelection).toHaveBeenCalledOnce()
    await render({
      selectionStatus: 'none',
      selectedKey: null,
      selection: null,
      item: null
    })
    expect(rowKeys()).toEqual(['submission:3', 'submission:1', 'submission:2'])
    expect(
      dom.window.document.querySelector<HTMLInputElement>(
        'input[type="search"]'
      )?.value
    ).toBe('作者搜索')
    expect(dom.window.document.querySelector('[data-inbox-action]')).toBeNull()
  })
})
