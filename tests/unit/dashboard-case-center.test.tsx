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
      case: 7
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

  /** Secondary-nav entries render twice (column + strip); either one works. */
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

  it('opens on the overview, which reports on the default queue only', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeRow()], 1, SAMPLE_COUNTS)
    )
    const container = await mount()
    await flush()

    // 概览复用默认队列的响应，不另开聚合接口；只取队首几条
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/case', {
      page: 1,
      limit: 6
    })
    const statValue = (key: string) =>
      container.querySelector(
        `[data-case-stat="${key}"] [data-case-stat-value]`
      )?.textContent
    // 四张卡必须是四个口径：未结 8 = 5+1+2，待处理 6 = 5+1
    expect(statValue('unresolved')).toBe('8')
    expect(statValue('pending')).toBe('6')
    expect(statValue('oldest')).toBe('3 天')
    expect(statValue('today')).toBe('3')
    // 未结与待处理不能是同一个数字换个标签
    expect(statValue('unresolved')).not.toBe(statValue('pending'))
    const text = container.textContent ?? ''
    expect(text).toContain('未结事项')
    expect(text).toContain('待处理')
    expect(text).toContain('今日已处理')
    expect(text).toContain('最久等待的事项')
    expect(text).toContain('等待 3 天')
    // 概览没有详情面板
    expect(container.querySelector('[aria-label="事项详情"]')).toBeNull()
  })

  it('counts each navigation entry from the same keys it filters by', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeRow()], 1, SAMPLE_COUNTS)
    )
    const container = await mount()
    await flush()

    // 未结 8 = open 5 + waiting_owner 1 + waiting_reporter 2
    expect(navButton(container, 'unresolved').textContent).toBe('未结事项8')
    // 待处理 6 = open 5 + waiting_owner 1，是未结的子集
    expect(navButton(container, 'pending').textContent).toBe('待处理6')
    expect(navButton(container, 'waiting_reporter').textContent).toBe(
      '等待报告者2'
    )
    expect(navButton(container, 'resolved').textContent).toBe('已解决9')
    expect(navButton(container, 'rejected').textContent).toBe('已驳回3')
    // 全部 20 = 六键之和（merged 为 0）
    expect(navButton(container, 'all').textContent).toBe('全部事项20')
    // merged 不单独做入口，但被「全部事项」包含
    expect(container.querySelector('[data-case-view="merged"]')).toBeNull()
    expect(
      container.querySelector('[data-case-view="overview"]')
    ).not.toBeNull()
    // 重叠关系写在导航里，而不是留给人推断
    expect(container.textContent).toContain('子集')
  })

  it('never labels two navigation entries the same', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    // open 与 waiting_owner 在 CASE_STATUS_LABELS 里同为「等待处理方」，
    // 必须合成一个「待处理」入口而不是两个同名入口。导航渲染两套
    // （竖列 + 横条，互补隐藏），只数其中一套。
    const nav = container.querySelector('nav[aria-label="事项中心导航"]')!
    const labels = [...nav.querySelectorAll('[data-case-view]')].map(
      (element) => element.textContent?.replace(/\d+$/, '')
    )
    expect(labels.length).toBe(8)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('asks for open and waiting_owner together on the pending queue', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await act(async () => {
      navButton(container, 'pending').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?view=pending')
    await applyNavigation(lastPushedHref())
    await flush()
    // status=open 会漏掉「报告者已补充、球在站方」的那批
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      statuses: 'open,waiting_owner',
      page: 1,
      limit: 20
    })
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
      navButton(container, 'unresolved').click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?view=unresolved')
    await applyNavigation(lastPushedHref())
    await flush()
    // 未结事项不传任何状态参数：服务端默认窗口同时是收件箱队列的定义
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      page: 1,
      limit: 20
    })
  })

  it('lists publisher-owned cases apart from the staff queue (D22)', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeRow()], 1, SAMPLE_COUNTS)
    )
    const container = await mount()
    await flush()
    expect(navButton(container, 'unresolved').textContent).toBe('未结事项8')

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
    expect(navButton(container, 'unresolved').textContent).toBe('未结事项8')

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
    mocks.searchParams = new URLSearchParams('view=unresolved')
    mocks.kunFetchGet.mockResolvedValue(
      listResponse([makeRow()], 1, SAMPLE_COUNTS)
    )
    const container = await mount()
    await flush()

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/case', {
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
    mocks.searchParams = new URLSearchParams('view=unresolved')
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

  it('keeps the overview list as cards regardless of its width', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    // 概览的「最久等待」列表没有表头，不该在宽容器下变成无头表格
    expect(container.querySelector('[data-case-table-head]')).toBeNull()
    const rowGrid = container.querySelector('[data-case-row-id="11"] > span')!
    expect(rowGrid.className).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(rowGrid.className).not.toContain('@[52rem]:')
  })

  it('drops the vertical nav column whenever a detail is open', async () => {
    mocks.searchParams = new URLSearchParams('view=unresolved')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow({ id: 22 })]))
    const container = await mount()
    await flush()

    // 无详情：竖列 + 横条带各一套，按 lg 互补隐藏
    expect(
      [...container.querySelectorAll('[data-case-nav]')].map((element) =>
        element.getAttribute('data-case-nav')
      )
    ).toEqual(['vertical', 'horizontal'])

    mocks.searchParams = new URLSearchParams('view=unresolved&id=22')
    await act(async () => {
      root!.render(<CaseCenter />)
    })
    await flush()

    // 详情打开：只剩横条带。让断点在此处插入 224px 固定列，会使会话列
    // 在 1 像素视口变化内从 531px 掉到 384px。
    const navs = [...container.querySelectorAll('[data-case-nav]')]
    expect(
      navs.map((element) => element.getAttribute('data-case-nav'))
    ).toEqual(['horizontal'])
    expect(navs[0].className).not.toContain('lg:hidden')
    // 条带仍然给出全部七个入口
    expect(navs[0].querySelectorAll('[data-case-view]')).toHaveLength(8)
  })

  it('falls back to page 1 when the URL page exceeds the API limit', async () => {
    mocks.searchParams = new URLSearchParams('view=unresolved&page=2147483648')
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    await mount()
    await flush()

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/case', {
      page: 1,
      limit: 20
    })
  })

  it('filters by kind through the URL and refetches', async () => {
    mocks.searchParams = new URLSearchParams('view=unresolved')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await chooseOption(container, 'content_violation', 'content_violation')
    expect(lastPushedHref()).toContain('caseKind=content_violation')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
      kind: 'content_violation',
      page: 1,
      limit: 20
    })
  })

  it('submits search explicitly and keeps it out of the request until submitted', async () => {
    mocks.searchParams = new URLSearchParams('view=unresolved')
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
      search: '资源X',
      page: 1,
      limit: 20
    })
  })

  it('narrows a submitted search to the chosen field through the URL (M03-9)', async () => {
    mocks.searchParams = new URLSearchParams('view=unresolved&search=%238')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await chooseOption(container, 'reporter', 'id')
    expect(lastPushedHref()).toContain('searchField=id')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/admin/case', {
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
    mocks.searchParams = new URLSearchParams('view=unresolved')
    mocks.kunFetchGet.mockResolvedValue(listResponse([makeRow()]))
    const container = await mount()
    await flush()

    await chooseOption(container, 'reporter', 'reporter')
    await applyNavigation(lastPushedHref())
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(1)
  })

  it('runs a search typed on the overview against the default queue', async () => {
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
    await act(async () => {
      findButton(container, '搜索').click()
    })
    expect(lastPushedHref()).toContain('view=unresolved')
    expect(lastPushedHref()).toContain('search=')
  })

  it('opens a row detail and advances to the neighbor after processing', async () => {
    mocks.searchParams = new URLSearchParams('view=unresolved')
    const rows = [makeRow({ id: 11 }), makeRow({ id: 22 }), makeRow({ id: 33 })]
    mocks.kunFetchGet.mockResolvedValue(listResponse(rows, 3))
    const container = await mount()
    await flush()

    const row = container.querySelector('[data-case-row-id="22"]')!
    await act(async () => {
      ;(row as HTMLElement).click()
    })
    expect(lastPushedHref()).toBe('/dashboard/case?view=unresolved&id=22')
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

    // 深链没有 view 参数，落到默认队列，因为概览没有详情面板
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/admin/case', {
      page: 1,
      limit: 20
    })
    expect(container.textContent).toContain('事项 42 的详情')
  })

  it('shows a retryable error and an empty state', async () => {
    mocks.searchParams = new URLSearchParams('view=unresolved')
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
    expect(container.textContent).toContain('站方队列当前没有未结事项')
  })

  it('shows the invalid-selection panel for a malformed deep link', async () => {
    mocks.searchParams = new URLSearchParams('view=unresolved&id=abc')
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
})
