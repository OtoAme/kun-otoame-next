import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AdminCaseListItem,
  AdminCaseListResponse,
  CaseStatusCounts
} from '~/types/api/case'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  refreshCounts: vi.fn(),
  searchParams: new URLSearchParams(''),
  router: { push: vi.fn(), replace: vi.fn() },
  counts: {
    pending: {
      submission: 0,
      'resource-apply': 0,
      feedback: 0,
      report: 0,
      case: 7,
      'broken-link': 2
    },
    todayProcessed: 3
  }
}))

vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.kunFetchGet }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => '/dashboard/case',
  useRouter: () => mocks.router
}))
vi.mock('~/hooks/dashboard/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('~/components/dashboard/DashboardShell', () => ({
  useDashboard: () => ({
    counts: mocks.counts,
    countsLoading: false,
    refreshCounts: mocks.refreshCounts
  })
}))
vi.mock('~/components/dashboard/case/BrokenLinkQueue', () => ({
  BrokenLinkQueue: () => <section aria-label="资源盘失效链接列表" />
}))
vi.mock('~/components/dashboard/case/DashboardCaseDetail', () => ({
  DashboardCaseDetail: ({
    caseId,
    onProcessed,
    onStateChanged
  }: {
    caseId: number
    onProcessed?: () => void
    onStateChanged?: () => void
  }) => (
    <section aria-label="事项详情">
      <p>事项 {caseId} 的详情</p>
      <button type="button" onClick={() => onProcessed?.()}>
        模拟处理完成
      </button>
      <button type="button" onClick={() => onStateChanged?.()}>
        模拟状态变化
      </button>
    </section>
  )
}))
vi.mock('~/components/dashboard/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => null,
  // Layout persistence reaches for localStorage; the split itself is stubbed.
  useResizableLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: vi.fn(),
    groupRef: { current: null }
  })
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
vi.mock('~/components/dashboard/ui/select', async () => {
  const R = await import('react')
  const SelectContent = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  )
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) => {
      const elements = R.Children.toArray(children).filter(
        R.isValidElement
      ) as React.ReactElement<{ children?: React.ReactNode }>[]
      const content = elements.find((element) => element.type === SelectContent)
      return (
        <select
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {content?.props.children}
        </select>
      )
    },
    SelectTrigger: () => null,
    SelectContent,
    SelectItem: (props: React.ComponentProps<'option'>) => (
      <option {...props} />
    ),
    SelectValue: () => null
  }
})

import { CaseCenter } from '~/components/dashboard/case/CaseCenter'

globalThis.React = React

const makeRow = (
  overrides: Partial<AdminCaseListItem> = {}
): AdminCaseListItem => ({
  id: 11,
  kind: 'resource_mismatch',
  targetType: 'resource',
  targetId: 7,
  target: {
    targetType: 'resource',
    targetId: 7,
    deleted: false,
    patch: { id: 3, uniqueId: 'abc', name: '条目A' },
    resource: {
      id: 7,
      name: '资源X',
      section: 'galgame',
      patchId: 3,
      patch: { id: 3, uniqueId: 'abc', name: '条目A' },
      status: 0
    }
  },
  patchId: 3,
  ownerType: 'staff',
  owner: null,
  reporter: { id: 5, name: '举报人', avatar: '' },
  status: 'open',
  resolution: null,
  public: true,
  source: 'user',
  subscriberCount: 2,
  reopenedCount: 0,
  escalatedAt: null,
  firstOwnerResponseAt: null,
  closedAt: null,
  statusChangedAt: '2026-09-10T00:00:00.000Z',
  queueEnteredAt: '2026-09-10T00:00:00.000Z',
  hiddenAt: null,
  restoredAt: null,
  created: '2026-09-10T00:00:00.000Z',
  updated: '2026-09-10T00:00:00.000Z',
  latestMessage: {
    id: 51,
    kind: 'reply',
    event: null,
    body: '请补充截图',
    created: '2026-09-12T00:00:00.000Z'
  },
  ...overrides
})

const listResponse = (
  rows: AdminCaseListItem[],
  total = rows.length,
  statusCounts: Partial<CaseStatusCounts> = {}
): AdminCaseListResponse => ({
  cases: rows,
  total,
  statusCounts: {
    open: 0,
    waiting_reporter: 0,
    waiting_owner: 0,
    resolved: 0,
    rejected: 0,
    merged: 0,
    ...statusCounts
  },
  page: 1,
  limit: 20,
  now: '2026-09-13T00:00:00.000Z'
})

const SAMPLE_COUNTS: Partial<CaseStatusCounts> = {
  open: 5,
  waiting_owner: 1,
  waiting_reporter: 2,
  resolved: 9,
  rejected: 3
}

describe('dashboard case center', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.searchParams = new URLSearchParams('')
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async (initialCaseId?: number) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard/case'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // react-dom 必须在 window/document stub 之后加载，否则合成事件不生效
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(<CaseCenter initialCaseId={initialCaseId} />)
    })
    return container
  }

  const flush = async () => {
    await act(async () => {})
  }

  /** Simulates the router navigation the component asked for. */
  const applyNavigation = async (href: string) => {
    mocks.searchParams = new URLSearchParams(href.split('?')[1] ?? '')
    await act(async () => {
      root!.render(<CaseCenter />)
    })
  }

  const lastPushedHref = () => {
    const calls = mocks.router.push.mock.calls
    return calls.length ? String(calls[calls.length - 1][0]) : ''
  }

  /** Secondary-nav entries live in the single strip above the list. */
  const navButton = (container: HTMLElement, view: string) =>
    container.querySelector<HTMLButtonElement>(
      `button[data-case-view="${view}"]`
    )!

  const findButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === text
    )!

  /** The mocked selects render natively; pick one by an option it offers. */
  const chooseOption = async (
    container: HTMLElement,
    offered: string,
    value: string
  ) => {
    const select = [...container.querySelectorAll('select')].find((element) =>
      element.querySelector(`option[value="${offered}"]`)
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLSelectElement.prototype,
        'value'
      )!.set!.call(select, value)
      select.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
  }

  it('opens on the staff to-do queue', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeRow()], 1, SAMPLE_COUNTS)
    )
    const container = await mount()
    await flush()

    // open alone would drop the cases a reporter has just answered
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/case', {
      statuses: 'open,waiting_owner',
      page: 1,
      limit: 20
    })
    expect(navButton(container, 'pending').getAttribute('aria-current')).toBe(
      'page'
    )
    expect(container.textContent).toContain('#11')
  })

  it('counts each navigation entry from the same keys it filters by', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeRow()], 1, SAMPLE_COUNTS)
    )
    const container = await mount()
    await flush()

    // 待处理 6 = open 5 + waiting_owner 1
    expect(navButton(container, 'pending').textContent).toBe('待处理6')
    expect(navButton(container, 'waiting_reporter').textContent).toBe(
      '等待报告者2'
    )
    // Broken disk links come from the shell counts, not the case list.
    expect(navButton(container, 'broken-link').textContent).toBe(
      '资源盘链接失效2'
    )
    // 已结案 12 = resolved 9 + rejected 3；全部 20 = 六键之和
    expect(navButton(container, 'closed').textContent).toBe('已结案12')
    expect(navButton(container, 'all').textContent).toBe('全部20')
    expect(container.querySelector('[data-case-view="merged"]')).toBeNull()
  })

  it('never labels two navigation entries the same', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    // open 与 waiting_owner 在 CASE_STATUS_LABELS 里同为「等待处理方」，
    // 必须合成一个「待处理」入口而不是两个同名入口。导航渲染两套
    // （竖列 + 横条，互补隐藏），只数其中一套。
    const nav = container.querySelector('nav[aria-label="问题处理导航"]')!
    const labels = [...nav.querySelectorAll('[data-case-view]')].map(
      (element) => element.textContent?.replace(/\d+$/, '')
    )
    expect(labels.length).toBe(6)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('lists broken resource-disk links instead of cases on that view', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await act(async () => {
      navButton(container, 'broken-link').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?view=broken-link')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(
      container.querySelector('[aria-label="资源盘失效链接列表"]')
    ).not.toBeNull()
    expect(container.querySelector('[data-case-queue-list]')).toBeNull()
  })

  it('routes the other queues through the URL with a single status parameter', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await act(async () => {
      navButton(container, 'waiting_reporter').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?view=waiting_reporter')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'waiting_reporter',
      page: 1,
      limit: 20
    })

    await act(async () => {
      navButton(container, 'closed').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?view=closed')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'resolved,rejected',
      page: 1,
      limit: 20
    })

    // The default view is not written into the URL.
    await act(async () => {
      navButton(container, 'pending').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case')
  })

  it('lists publisher-owned cases apart from the staff queue (D22)', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeRow()], 1, SAMPLE_COUNTS)
    )
    const container = await mount()
    await flush()
    expect(navButton(container, 'pending').textContent).toBe('待处理6')

    await act(async () => {
      navButton(container, 'publisher').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?view=publisher')
    mocks.kunFetchGet.mockResolvedValue(
      listResponse(
        [
          makeRow({
            id: 12,
            ownerType: 'publisher',
            owner: { id: 2, name: '发布者甲', avatar: '' },
            reopenedCount: 1
          })
        ],
        1,
        { open: 1 }
      )
    )
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      ownerType: 'publisher',
      page: 1,
      limit: 20
    })
    // Rows name the publisher and the reopen count; the view has no badge and
    // the staff badges keep the staff numbers.
    const text = container.textContent ?? ''
    expect(text).toContain('发布者甲')
    expect(text).toContain('重开 1 次')
    expect(navButton(container, 'publisher').textContent).toBe('发布者处理中')
    expect(navButton(container, 'pending').textContent).toBe('待处理6')

    // 可按发布者筛选
    const ownerInput =
      container.querySelector<HTMLInputElement>('#case-owner-filter')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLInputElement.prototype,
        'value'
      )!.set!.call(ownerInput, '2')
      ownerInput.dispatchEvent(
        new dom!.window.Event('input', { bubbles: true })
      )
    })
    await act(async () => {
      findButton(container, '筛选').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?view=publisher&owner=2')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      ownerType: 'publisher',
      ownerId: '2',
      page: 1,
      limit: 20
    })
  })

  it('asks for allStatuses rather than enumerating them on the all view', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await act(async () => {
      navButton(container, 'all').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?view=all')
    await applyNavigation(lastPushedHref())
    await flush()
    // 枚举写死会在模块 06 开始写入 merged 后静默漏单；且只送一个状态参数
    const params = mocks.kunFetchGet.mock.calls.at(-1)![1]
    expect(params).toEqual({ allStatuses: 'true', page: 1, limit: 20 })
  })

  it('renders queue rows with the aligned column fields', async () => {
    mocks.searchParams = new URLSearchParams('view=pending')
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeRow()], 1, SAMPLE_COUNTS)
    )
    const container = await mount()
    await flush()

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/case', {
      statuses: 'open,waiting_owner',
      page: 1,
      limit: 20
    })
    const text = container.textContent ?? ''
    // 列表行：编号、目标、状态、类型、报告者、人数、等待时长、最新消息
    expect(text).toContain('#11')
    expect(text).toContain('资源X（条目A）')
    expect(text).toContain('等待处理方')
    expect(text).toContain('资源与描述不符')
    expect(text).toContain('举报人')
    expect(text).toContain('2 人报告')
    expect(text).toContain('等待 3 天')
    expect(text).toContain('请补充截图')
    // 未选中时列表独占整个宽度，不渲染空详情面板
    expect(container.querySelector('[aria-label="事项详情"]')).toBeNull()
  })

  it('drives the queue layout off the container width, not the viewport', async () => {
    mocks.searchParams = new URLSearchParams('view=pending')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    // 视口宽不等于列表栏宽：详情打开、lg 起插入二级导航、用户拖窄，三者都会
    // 让列表栏远小于视口。按视口判断会把首列压到 0–24px，行就认不出是哪条了。
    const listRoot = container.querySelector('[data-case-queue-list]')!
    expect(listRoot.className).toContain('@container')

    // 表头与列模板都挂在同一个容器阈值上，窄容器下整体退回卡片
    const head = container.querySelector('[data-case-table-head]')!
    expect(head.className).toContain('hidden')
    expect(head.className).toContain('@[52rem]:grid')

    const rowGrid = container.querySelector('[data-case-row-id="11"] > span')!
    expect(rowGrid.className).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(rowGrid.className).toContain('@[52rem]:grid-cols-[minmax(0,1fr)_')
  })

  it('keeps one navigation strip whether or not a detail is open', async () => {
    mocks.searchParams = new URLSearchParams('view=pending')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow({ id: 22 })]))
    const container = await mount()
    await flush()

    const strips = () =>
      [...container.querySelectorAll('[data-case-nav]')].map((element) =>
        element.getAttribute('data-case-nav')
      )
    expect(strips()).toEqual(['strip'])

    mocks.searchParams = new URLSearchParams('view=pending&id=22')
    await act(async () => {
      root!.render(<CaseCenter />)
    })
    await flush()

    // A side column would change the list and detail widths on open.
    expect(strips()).toEqual(['strip'])
    expect(
      container.querySelectorAll('[data-case-nav] [data-case-view]')
    ).toHaveLength(6)
  })

  it('falls back to page 1 when the URL page exceeds the API limit', async () => {
    mocks.searchParams = new URLSearchParams('view=pending&page=2147483648')
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    await mount()
    await flush()

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/case', {
      statuses: 'open,waiting_owner',
      page: 1,
      limit: 20
    })
  })

  it('filters by kind through the URL and refetches', async () => {
    mocks.searchParams = new URLSearchParams('view=pending')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await chooseOption(container, 'content_violation', 'content_violation')
    expect(lastPushedHref()).toContain('caseKind=content_violation')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'open,waiting_owner',
      kind: 'content_violation',
      page: 1,
      limit: 20
    })
  })

  it('submits search explicitly and keeps it out of the request until submitted', async () => {
    mocks.searchParams = new URLSearchParams('view=pending')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    const input = container.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, '资源X')
      input.dispatchEvent(new dom!.window.Event('input', { bubbles: true }))
    })
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)

    await act(async () => {
      findButton(container, '搜索').click()
    })
    expect(lastPushedHref()).toContain('search=')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'open,waiting_owner',
      search: '资源X',
      page: 1,
      limit: 20
    })
  })

  it('narrows a submitted search to the chosen field through the URL (M03-9)', async () => {
    mocks.searchParams = new URLSearchParams('view=pending&search=%238')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await chooseOption(container, 'reporter', 'id')
    expect(lastPushedHref()).toContain('searchField=id')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'open,waiting_owner',
      search: '#8',
      searchField: 'id',
      page: 1,
      limit: 20
    })
    expect(
      container.querySelector<HTMLInputElement>('input[type="search"]')!
        .placeholder
    ).toBe('输入事项编号，如 8 或 #8')
  })

  it('does not refetch when only the field changes without a search', async () => {
    mocks.searchParams = new URLSearchParams('view=pending')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await chooseOption(container, 'reporter', 'reporter')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
  })

  it('opens a row detail and advances to the neighbor after processing', async () => {
    mocks.searchParams = new URLSearchParams('view=pending')
    const rows = [makeRow({ id: 11 }), makeRow({ id: 22 }), makeRow({ id: 33 })]
    mocks.kunFetchGet.mockResolvedValue(listResponse(rows, 3))
    const container = await mount()
    await flush()

    const row = container.querySelector('[data-case-row-id="22"]')!
    await act(async () => {
      ;(row as HTMLElement).click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?id=22')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(container.textContent).toContain('事项 22 的详情')

    // 终结动作：选中推进到邻居行、刷新列表与壳层计数
    await act(async () => {
      findButton(container, '模拟处理完成').click()
    })
    await flush()
    const replaceCalls = mocks.router.replace.mock.calls
    expect(replaceCalls.length).toBeGreaterThan(0)
    expect(String(replaceCalls[replaceCalls.length - 1][0])).toContain('id=33')
    expect(mocks.refreshCounts).toHaveBeenCalled()
    // 列表重新请求
    expect(
      mocks.kunFetchGet.mock.calls.filter((call) => call[0] === '/admin/case')
        .length
    ).toBeGreaterThanOrEqual(2)
  })

  it('opens the detail for a /dashboard/case/[id] deep link', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow({ id: 11 })]))
    const container = await mount(42)
    await flush()

    // A deep link names a case of any status, so it lands on 全部.
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/case', {
      allStatuses: 'true',
      page: 1,
      limit: 20
    })
    expect(container.textContent).toContain('事项 42 的详情')
  })

  it('shows a retryable error and an empty state', async () => {
    mocks.searchParams = new URLSearchParams('view=pending')
    mocks.kunFetchGet.mockResolvedValue('加载事项列表失败')
    const container = await mount()
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '加载事项列表失败'
    )

    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    await act(async () => {
      findButton(container, '重试').click()
    })
    await flush()
    expect(container.textContent).toContain('没有等待站方处理的问题')
  })

  it('shows the invalid-selection panel for a malformed deep link', async () => {
    mocks.searchParams = new URLSearchParams('view=pending&id=abc')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()
    expect(container.textContent).toContain('事项链接无效')
    await act(async () => {
      findButton(container, '返回列表').click()
    })
    expect(mocks.router.push).toHaveBeenCalled()
    expect(lastPushedHref()).not.toContain('id=')
  })

  /** Values offered by the status filter, or null when it is not shown. */
  const statusOptions = (container: HTMLElement) => {
    const select = [...container.querySelectorAll('select')].find(
      (element) =>
        element.querySelector('option[value="resolved"]') ||
        element.querySelector('option[value="waiting_reporter"]')
    )
    return select
      ? [...select.querySelectorAll('option')].map((option) => option.value)
      : null
  }

  it('filters by a status group through the URL instead of the view statuses', async () => {
    mocks.searchParams = new URLSearchParams('view=all&page=2')
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeRow()], 1, SAMPLE_COUNTS)
    )
    const container = await mount()
    await flush()

    // 按界面状态分组：open 与 waiting_owner 同为「等待处理方」，合成一项
    expect(statusOptions(container)).toEqual([
      'all',
      'pending',
      'waiting_reporter',
      'resolved',
      'rejected'
    ])
    await chooseOption(container, 'rejected', 'rejected')
    // 筛选变化回到第 1 页
    expect(lastPushedHref()).toBe(
      '/dashboard/case?view=all&caseStatus=rejected'
    )
    await applyNavigation(lastPushedHref())
    await flush()
    // 代替视图自身的 allStatuses，而不是叠加
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'rejected',
      page: 1,
      limit: 20
    })
    // 导航徽标仍是整个视图的计数
    expect(navButton(container, 'all').textContent).toBe('全部20')
  })

  it('offers only the status groups the current view spans', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()
    // 只剩一个分组的视图本身就是这个筛选
    expect(statusOptions(container)).toBeNull()
    await applyNavigation('/dashboard/case?view=waiting_reporter')
    expect(statusOptions(container)).toBeNull()

    await applyNavigation('/dashboard/case?view=closed')
    expect(statusOptions(container)).toEqual(['all', 'resolved', 'rejected'])

    // 发布者处理中只有前两组，状态筛选保留 ownerType
    await applyNavigation('/dashboard/case?view=publisher')
    expect(statusOptions(container)).toEqual([
      'all',
      'pending',
      'waiting_reporter'
    ])
    await chooseOption(container, 'pending', 'pending')
    expect(lastPushedHref()).toBe(
      '/dashboard/case?view=publisher&caseStatus=pending'
    )
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      ownerType: 'publisher',
      statuses: 'open,waiting_owner',
      page: 1,
      limit: 20
    })

    // 手改网址带上视图之外的分组时忽略它
    await applyNavigation('/dashboard/case?view=closed&caseStatus=pending')
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'resolved,rejected',
      page: 1,
      limit: 20
    })
  })

  it('keeps the status filter across kind and search changes and clears it on a view switch', async () => {
    mocks.searchParams = new URLSearchParams('view=all&caseStatus=rejected')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await chooseOption(container, 'content_violation', 'content_violation')
    expect(lastPushedHref()).toBe(
      '/dashboard/case?view=all&caseKind=content_violation&caseStatus=rejected'
    )
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'rejected',
      kind: 'content_violation',
      page: 1,
      limit: 20
    })

    const input = container.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, '资源X')
      input.dispatchEvent(new dom!.window.Event('input', { bubbles: true }))
    })
    await act(async () => {
      findButton(container, '搜索').click()
    })
    expect(lastPushedHref()).toContain('caseStatus=rejected')
    expect(lastPushedHref()).toContain('search=')

    await act(async () => {
      navButton(container, 'waiting_reporter').click()
    })
    expect(lastPushedHref()).toBe(
      '/dashboard/case?view=waiting_reporter&caseKind=content_violation'
    )
  })

  /** Column heads carry the sort key they request. */
  const sortButton = (container: HTMLElement, sort: string) =>
    container.querySelector<HTMLButtonElement>(
      `button[data-case-sort="${sort}"]`
    )!

  it('sorts by a column head, flipping the current one like Explorer', async () => {
    mocks.searchParams = new URLSearchParams('view=pending&page=2')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()], 21))
    const container = await mount()
    await flush()

    // 表头是可用键盘操作的按钮，不再对读屏隐藏
    const head = container.querySelector('[data-case-table-head]')!
    expect(head.getAttribute('aria-hidden')).toBeNull()
    expect(
      [...head.querySelectorAll('button')].map((button) =>
        button.getAttribute('aria-label')
      )
    ).toEqual([
      '按编号与目标排序',
      '按状态排序',
      '按类型排序',
      '按提交人排序',
      '按时间排序，当前升序'
    ])
    expect(sortButton(container, 'time').querySelector('svg')).not.toBeNull()
    expect(sortButton(container, 'kind').querySelector('svg')).toBeNull()

    // 点当前列切换升降序，换排序回到第 1 页，默认值不写进网址
    await act(async () => {
      sortButton(container, 'time').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?order=desc')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'open,waiting_owner',
      order: 'desc',
      page: 1,
      limit: 20
    })
    expect(sortButton(container, 'time').getAttribute('aria-label')).toBe(
      '按时间排序，当前降序'
    )

    // 点另一列从升序开始
    await act(async () => {
      sortButton(container, 'kind').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?sort=kind')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'open,waiting_owner',
      sort: 'kind',
      page: 1,
      limit: 20
    })
    await act(async () => {
      sortButton(container, 'kind').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?sort=kind&order=desc')
    await applyNavigation(lastPushedHref())
    await flush()
    await act(async () => {
      sortButton(container, 'status').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?sort=status')
  })

  it('reads the sort from the URL and sorts the publisher view by its publisher', async () => {
    mocks.searchParams = new URLSearchParams(
      'view=publisher&sort=owner&order=desc'
    )
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      ownerType: 'publisher',
      sort: 'owner',
      order: 'desc',
      page: 1,
      limit: 20
    })
    expect(sortButton(container, 'reporter')).toBeNull()
    expect(sortButton(container, 'owner').getAttribute('aria-label')).toBe(
      '按发布者排序，当前降序'
    )

    // 人名这一列换个视图仍按人名排：站方视图里它是提交人
    await act(async () => {
      navButton(container, 'all').click()
    })
    expect(lastPushedHref()).toBe(
      '/dashboard/case?view=all&sort=reporter&order=desc'
    )
  })
})
