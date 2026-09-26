import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CaseListItem,
  CaseListResponse,
  CaseStatusCounts
} from '~/types/api/case'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  searchParams: new URLSearchParams(''),
  router: { push: vi.fn(), replace: vi.fn() }
}))

vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.kunFetchGet }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  usePathname: () => '/issue',
  useRouter: () => mocks.router
}))
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
    'aria-current': ariaCurrent
  }: {
    children?: React.ReactNode
    href: string
    className?: string
    'aria-current'?: React.AriaAttributes['aria-current']
  }) => (
    <a href={href} className={className} aria-current={ariaCurrent}>
      {children}
    </a>
  )
}))

vi.mock('~/components/dashboard/issue/IssueCaseDetail', () => ({
  IssueCaseDetail: ({ caseId }: { caseId: number }) => (
    <section aria-label="问题详情">问题 {caseId} 的详情</section>
  )
}))

vi.mock('~/components/dashboard/ui/tabs', async () => {
  const R = await import('react')
  const Ctx = R.createContext<{ onValueChange?: (value: string) => void }>({})
  return {
    Tabs: ({
      children,
      onValueChange
    }: {
      children?: React.ReactNode
      onValueChange?: (value: string) => void
    }) => <Ctx.Provider value={{ onValueChange }}>{children}</Ctx.Provider>,
    TabsList: ({ children }: { children?: React.ReactNode }) => (
      <div role="tablist">{children}</div>
    ),
    TabsTrigger: ({
      children,
      value
    }: {
      children?: React.ReactNode
      value: string
    }) => {
      const { onValueChange } = R.useContext(Ctx)
      return (
        <button
          type="button"
          role="tab"
          data-value={value}
          onClick={() => onValueChange?.(value)}
        >
          {children}
        </button>
      )
    }
  }
})

import { IssueWorkspace } from '~/components/dashboard/issue/IssueWorkspace'

globalThis.React = React

const listItem = (overrides: Partial<CaseListItem> = {}): CaseListItem => ({
  id: 1,
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
  ownerType: 'publisher',
  owner: null,
  reporter: null,
  status: 'open',
  resolution: null,
  public: true,
  source: 'user',
  subscriberCount: 2,
  reopenedCount: 0,
  escalatedAt: null,
  firstOwnerResponseAt: null,
  closedAt: null,
  statusChangedAt: '2026-09-13T00:00:00.000Z',
  queueEnteredAt: '2026-09-13T00:00:00.000Z',
  hiddenAt: null,
  restoredAt: null,
  created: '2026-09-13T00:00:00.000Z',
  updated: '2026-09-13T00:00:00.000Z',
  hasUnread: false,
  handedOff: false,
  latestMessage: {
    id: 11,
    kind: 'reply',
    event: null,
    body: '正文预览内容',
    created: '2026-09-13T00:00:00.000Z'
  },
  canReply: true,
  canResolve: false,
  canReopen: false,
  ...overrides
})

const counts = (
  overrides: Partial<CaseStatusCounts> = {}
): CaseStatusCounts => ({
  open: 0,
  waiting_reporter: 0,
  waiting_owner: 0,
  resolved: 0,
  rejected: 0,
  merged: 0,
  ...overrides
})

const listResponse = (
  items: CaseListItem[],
  total = items.length,
  statusCounts: CaseStatusCounts = counts()
): CaseListResponse => ({
  tab: 'reported',
  cases: items,
  total,
  statusCounts,
  page: 1,
  limit: 20
})

describe('issue workspace', () => {
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

  const mount = async (ui: React.ReactElement) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // react-dom 必须在 window/document stub 之后加载，否则合成事件不生效
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    return container
  }

  const flush = async () => {
    await act(async () => {})
  }

  const findTab = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('[role="tab"]')].find((tab) =>
      tab.textContent?.startsWith(label)
    ) as HTMLElement | undefined

  it('fetches the reported tab without a status filter and renders rows', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([listItem()]))
    const container = await mount(<IssueWorkspace />)
    await flush()

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/case', {
      tab: 'reported',
      page: 1,
      limit: 20
    })
    const text = container.textContent ?? ''
    expect(text).toContain('资源与描述不符')
    expect(text).toContain('等待处理方')
    expect(text).toContain('2 人报告')
    expect(text).toContain('资源X（条目A）')
    expect(text).toContain('正文预览内容')
    // 工作区内选中走查询参数，详情深链仍是 /issue/1
    expect(container.querySelector('a[href="/issue?id=1"]')).not.toBeNull()
  })

  it('groups status tabs into four and counts them from statusCounts', async () => {
    mocks.kunFetchGet.mockResolvedValue(
      listResponse(
        [listItem()],
        11,
        counts({
          open: 2,
          waiting_owner: 1,
          waiting_reporter: 3,
          resolved: 4,
          rejected: 1
        })
      )
    )
    const container = await mount(<IssueWorkspace />)
    await flush()

    // 四组的并集等于全部，没有哪个状态只能在「全部」里看到
    expect(findTab(container, '全部')?.textContent).toBe('全部11')
    expect(findTab(container, '等待处理方')?.textContent).toBe('等待处理方3')
    // 我提交的分页里 waiting_reporter 就是等我补充
    expect(findTab(container, '等待我补充')?.textContent).toBe('等待我补充3')
    // rejected 不单独成页签，但并进「已结案」而不是只能从「全部」看到
    expect(findTab(container, '已结案')?.textContent).toBe('已结案5')
  })

  it('switches tabs, filters by merged status, and paginates through the URL', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([listItem()], 40))
    let container = await mount(<IssueWorkspace />)
    await flush()

    // 切到「待我处理」：page 重置、选中清空
    await act(async () => {
      findTab(container, '待我处理')!.click()
    })
    expect(mocks.router.push).toHaveBeenLastCalledWith('/issue?tab=owned', {
      scroll: false
    })

    // 「等待处理方」页签把 open 与 waiting_owner 一次筛出
    await act(async () => {
      findTab(container, '等待处理方')!.click()
    })
    expect(mocks.router.push).toHaveBeenLastCalledWith(
      '/issue?status=processing',
      { scroll: false }
    )

    act(() => {
      root?.unmount()
    })
    root = undefined
    mocks.searchParams = new URLSearchParams('tab=owned&status=processing')
    container = await mount(<IssueWorkspace />)
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/case', {
      tab: 'owned',
      statuses: 'open,waiting_owner',
      page: 1,
      limit: 20
    })
    // 在「待我处理」分页里，同一组换成第一人称，与列表行徽标口径一致
    expect(findTab(container, '等待我处理')?.textContent).toBe('等待我处理0')

    // 「已结案」合并 resolved 与 rejected
    await act(async () => {
      findTab(container, '已结案')!.click()
    })
    expect(mocks.router.push).toHaveBeenLastCalledWith(
      '/issue?tab=owned&status=closed',
      { scroll: false }
    )

    act(() => {
      root?.unmount()
    })
    root = undefined
    mocks.searchParams = new URLSearchParams('tab=owned&status=closed')
    container = await mount(<IssueWorkspace />)
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenLastCalledWith('/case', {
      tab: 'owned',
      statuses: 'resolved,rejected',
      page: 1,
      limit: 20
    })

    const nextPage = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '下一页'
    )!
    await act(async () => {
      nextPage.click()
    })
    expect(mocks.router.push).toHaveBeenLastCalledWith(
      '/issue?tab=owned&status=closed&page=2',
      { scroll: false }
    )
  })

  it('shows the empty state, surfaces load errors, and retries', async () => {
    mocks.kunFetchGet.mockResolvedValue(listResponse([]))
    const container = await mount(<IssueWorkspace />)
    await flush()
    expect(container.textContent).toContain('暂无问题')

    mocks.kunFetchGet.mockResolvedValue('请先登录')
    const refresh = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('刷新')
    )!
    await act(async () => {
      refresh.click()
    })
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '请先登录'
    )

    mocks.kunFetchGet.mockResolvedValue(listResponse([listItem()]))
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '重新加载'
    )!
    await act(async () => {
      retry.click()
    })
    await flush()
    expect(container.textContent).toContain('资源X（条目A）')
  })
})
