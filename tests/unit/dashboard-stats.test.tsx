import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardStatsSumData, OverviewData } from '~/types/api/admin'
import type { InboxCounts, InboxItem } from '~/types/api/inbox'

const mocks = vi.hoisted(() => {
  const refreshCounts = vi.fn()
  return {
    get: vi.fn(),
    refreshCounts,
    context: {
      counts: null as InboxCounts | null,
      countsLoading: false,
      countsError: '',
      refreshCounts
    }
  }
})
vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: mocks.get }))
vi.mock('~/components/dashboard/DashboardShell', () => ({
  useDashboard: () => mocks.context
}))
vi.mock('next/link', () => ({
  default: (props: React.ComponentProps<'a'>) => <a {...props} />
}))
vi.mock('~/components/dashboard/ui/input', () => ({
  // React onChange stays stale under this harness; map onInput -> onChange.
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={(event) =>
        onChange?.(event as React.ChangeEvent<HTMLInputElement>)
      }
    />
  )
}))

import { DashboardStats } from '~/components/dashboard/DashboardStats'

const sumData: DashboardStatsSumData = {
  userCount: 120,
  galgameCount: 45,
  galgameResourceCount: 67,
  galgamePatchResourceCount: 23,
  galgameCommentCount: 890,
  ratingCount: 56,
  submissionCount: 34,
  creatorCount: 12,
  pendingCreatorApplyCount: 9
}
const zeroSum: DashboardStatsSumData = {
  userCount: 0,
  galgameCount: 0,
  galgameResourceCount: 0,
  galgamePatchResourceCount: 0,
  galgameCommentCount: 0,
  ratingCount: 0,
  submissionCount: 0,
  creatorCount: 0,
  pendingCreatorApplyCount: 0
}
const overviewData: OverviewData = {
  newUser: 7,
  newActiveUser: 15,
  newGalgame: 3,
  newGalgameResource: 5,
  newComment: 21
}
const zeroOverview: OverviewData = {
  newUser: 0,
  newActiveUser: 0,
  newGalgame: 0,
  newGalgameResource: 0,
  newComment: 0
}
const counts: InboxCounts = {
  pending: {
    submission: 5,
    'resource-apply': 2,
    feedback: 3,
    report: 1,
    case: 4,
    'broken-link': 0
  },
  todayProcessed: 4
}
const zeroCounts: InboxCounts = {
  pending: {
    submission: 0,
    'resource-apply': 0,
    feedback: 0,
    report: 0,
    case: 0,
    'broken-link': 0
  },
  todayProcessed: 0
}

const oldestItem = {
  key: 'resource-apply:31',
  kind: 'resource-apply',
  id: 31,
  title: '夏空カナタ 中文补丁',
  subtitle: '',
  actor: { id: 5, name: 'kuro' },
  waitingFrom: '2026-10-25T00:00:00.000Z',
  waitingSeconds: 52 * 3600,
  targetHref: '',
  badges: [],
  readOnly: false,
  payload: {}
} as unknown as InboxItem

// Every overview read the page may issue, keyed by URL.
const okResponses: Record<string, unknown> = {
  '/admin/stats/sum': sumData,
  '/admin/stats': overviewData,
  '/admin/inbox': { items: [oldestItem], totals: {}, truncated: {} },
  '/admin/company-merges': { items: [{ id: 1 }, { id: 2 }] },
  '/admin/creator': { creators: [], total: 9 },
  '/admin/log': {
    logs: [
      {
        id: 9,
        type: 'resource_apply_approve',
        user: { id: 2, name: '七海', avatar: '' },
        content: '资源申请通过：夏空カナタ',
        created: '2026-10-28T02:00:00.000Z'
      }
    ],
    total: 1
  },
  '/admin/setting/register': { disableRegister: false },
  '/admin/setting/redirect': {
    enableRedirect: false,
    excludedDomains: [],
    delaySeconds: 5
  }
}
const SUPER_ONLY = [
  '/admin/stats/sum',
  '/admin/stats',
  '/admin/log',
  '/admin/setting/register',
  '/admin/setting/redirect'
]

describe('dashboard overview', () => {
  let dom: JSDOM
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.context.counts = counts
    mocks.context.countsLoading = false
    mocks.context.countsError = ''
    mocks.get.mockImplementation((url: string) =>
      url in okResponses
        ? Promise.resolve(okResponses[url])
        : Promise.reject(new Error(`unexpected ${url}`))
    )
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const render = async (role: number) => {
    await act(async () => root.render(<DashboardStats reviewerRole={role} />))
  }
  const requested = () => mocks.get.mock.calls.map(([url]) => url as string)
  /** Value shown for a metric label inside the scale or growth panel. */
  const metric = (label: string): string | null => {
    const term = [...container.querySelectorAll('dt')].find(
      (el) => el.textContent === label
    )
    return term?.nextElementSibling?.textContent ?? null
  }
  const queueValue = (href: string): string | null => {
    const row = container.querySelector(`a[href="${href}"]`)
    return row?.children[2]?.textContent ?? null
  }
  const summaryValue = (label: string): string | null => {
    const cell = [...container.querySelectorAll('p')].find(
      (el) => el.textContent === label
    )
    return cell?.nextElementSibling?.textContent ?? null
  }
  const panel = (id: string) =>
    container.querySelector(`section[aria-labelledby="${id}"]`) as HTMLElement
  const retryIn = (id: string) =>
    [...panel(id).querySelectorAll('button')].find(
      (button) => button.textContent === '重试'
    )!
  const submitDays = async (value: string) => {
    const field = container.querySelector(
      'input[aria-label="统计天数"]'
    ) as HTMLInputElement
    await act(async () => {
      field.value = value
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => {
      field
        .closest('form')!
        .dispatchEvent(
          new dom.window.Event('submit', { bubbles: true, cancelable: true })
        )
    })
  }

  it('role 3 never requests private reads and sees only queues', async () => {
    await render(3)
    for (const url of SUPER_ONLY) expect(requested()).not.toContain(url)
    expect(queueValue('/dashboard/inbox?kinds=submission')).toBe('5')
    expect(queueValue('/dashboard/inbox?kinds=resource-apply')).toBe('2')
    expect(queueValue('/dashboard/inbox?kinds=feedback')).toBe('3')
    expect(queueValue('/dashboard/inbox?kinds=report')).toBe('1')
    expect(queueValue('/dashboard/inbox?kinds=case')).toBe('4')
    expect(queueValue('/dashboard/company-merges')).toBe('2')
    expect(summaryValue('待审事项')).toBe('15')
    expect(summaryValue('我今日已处理')).toBe('4')
    // Creator applications are reviewed by administrators, so role 3 sees them.
    expect(queueValue('/dashboard/creator')).toBe('9')
    for (const id of [
      'dashboard-sum-heading',
      'dashboard-overview-heading',
      'dashboard-status-heading',
      'dashboard-log-heading'
    ]) {
      expect(panel(id)).toBeNull()
    }
  })

  it('role 4 loads every panel', async () => {
    await render(4)
    for (const url of SUPER_ONLY) expect(requested()).toContain(url)
    expect(metric('用户')).toBe('120')
    expect(metric('评分')).toBe('56')
    expect(metric('投稿')).toBe('34')
    expect(metric('新注册用户')).toBe('7')
    expect(metric('最近登录')).toBe('15')
    expect(metric('新增评论')).toBe('21')
    expect(panel('dashboard-status-heading').textContent).toContain('开放')
    expect(panel('dashboard-log-heading').textContent).toContain('资源申请通过')
  })

  it('keeps creator applications and merge suggestions out of the inbox total', async () => {
    await render(4)
    expect(queueValue('/dashboard/creator')).toBe('9')
    expect(mocks.get).toHaveBeenCalledWith('/admin/creator', {
      page: 1,
      limit: 1,
      status: 'pending'
    })
    expect(queueValue('/dashboard/company-merges')).toBe('2')
    expect(summaryValue('待审事项')).toBe('15')
  })

  it('lists the oldest inbox items with a deep link to each', async () => {
    await render(3)
    expect(mocks.get).toHaveBeenCalledWith('/admin/inbox', { limitPerKind: 6 })
    const link = [...container.querySelectorAll('a')].find(
      (el) =>
        el.getAttribute('href') === '/dashboard/inbox?kind=resource-apply&id=31'
    )
    expect(link?.textContent).toContain('夏空カナタ 中文补丁')
    expect(link?.textContent).toContain('已等 2 天 4 小时')
  })

  it('says the inbox is empty instead of showing a blank list', async () => {
    okResponses['/admin/inbox'] = { items: [], totals: {}, truncated: {} }
    try {
      await render(3)
      expect(panel('dashboard-oldest-heading').textContent).toContain(
        '收件箱已清空'
      )
    } finally {
      okResponses['/admin/inbox'] = {
        items: [oldestItem],
        totals: {},
        truncated: {}
      }
    }
  })

  it('shows skeletons instead of fake zeros while loading', async () => {
    mocks.context.counts = null
    mocks.context.countsLoading = true
    mocks.get.mockReturnValue(new Promise(() => {}))
    await render(4)
    expect(metric('用户')).toBeNull()
    expect(metric('新注册用户')).toBeNull()
    expect(summaryValue('待审事项')).toBe('–')
    expect(queueValue('/dashboard/inbox?kinds=submission')).toBe('')
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it('renders a real zero only after zero-valued data loads', async () => {
    mocks.context.counts = zeroCounts
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/admin/stats/sum'
          ? zeroSum
          : url === '/admin/stats'
            ? zeroOverview
            : okResponses[url]
      )
    )
    await render(4)
    expect(metric('用户')).toBe('0')
    expect(metric('新注册用户')).toBe('0')
    expect(queueValue('/dashboard/inbox?kinds=submission')).toBe('0')
    expect(summaryValue('待审事项')).toBe('0')
  })

  it('fails and retries each panel independently', async () => {
    mocks.get.mockImplementation((url: string) =>
      url === '/admin/stats/sum'
        ? Promise.resolve('总量统计暂不可用')
        : Promise.resolve(okResponses[url])
    )
    await render(4)
    expect(panel('dashboard-sum-heading').textContent).toContain(
      '总量统计暂不可用'
    )
    expect(metric('新注册用户')).toBe('7')
    expect(queueValue('/dashboard/creator')).toBe('9')
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve(okResponses[url])
    )
    const before = requested().length
    await act(async () => retryIn('dashboard-sum-heading').click())
    expect(requested().slice(before)).toEqual(['/admin/stats/sum'])
    expect(metric('用户')).toBe('120')
  })

  it('shows a Chinese error on rejection and never auto retries', async () => {
    mocks.get.mockImplementation((url: string) =>
      url === '/admin/stats'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(okResponses[url])
    )
    await render(4)
    expect(panel('dashboard-overview-heading').textContent).toContain(
      '获取近期统计失败，请检查网络后重试'
    )
    expect(requested().filter((url) => url === '/admin/stats')).toHaveLength(1)
  })

  it('treats an empty string response as an error, not zero', async () => {
    mocks.get.mockImplementation((url: string) =>
      url === '/admin/log'
        ? Promise.resolve('')
        : Promise.resolve(okResponses[url])
    )
    await render(4)
    expect(panel('dashboard-log-heading').textContent).toContain(
      '获取管理日志失败'
    )
  })

  it('surfaces inbox count errors with manual retry via shell context', async () => {
    mocks.context.counts = null
    mocks.context.countsError = '计数暂不可用'
    await render(3)
    expect(queueValue('/dashboard/inbox?kinds=submission')).toBe('读取失败')
    await act(async () => retryIn('dashboard-queue-heading').click())
    expect(mocks.refreshCounts).toHaveBeenCalledOnce()
  })

  it('keeps loaded inbox counts visible next to a refresh error', async () => {
    mocks.context.countsError = '刷新失败'
    await render(3)
    expect(panel('dashboard-queue-heading').textContent).toContain('刷新失败')
    expect(queueValue('/dashboard/inbox?kinds=submission')).toBe('5')
  })

  it('refreshes every panel from one button', async () => {
    await render(4)
    const before = requested().length
    const button = [...container.querySelectorAll('button')].find(
      (el) => el.textContent === '刷新全部'
    )!
    await act(async () => button.click())
    expect(mocks.refreshCounts).toHaveBeenCalledOnce()
    expect(new Set(requested().slice(before))).toEqual(
      new Set([...Object.keys(okResponses)])
    )
  })

  it.each<[string, number, boolean]>([
    ['1', 1, true],
    ['30', 30, true],
    ['60', 60, true],
    ['0', 0, false],
    ['61', 0, false],
    ['-3', 0, false],
    ['1.5', 0, false],
    ['abc', 0, false],
    ['', 0, false]
  ])(
    'accepts only integer windows within 1..60 (%s)',
    async (input, expected, valid) => {
      await render(4)
      mocks.get.mockClear()
      await submitDays(input)
      if (valid) {
        expect(mocks.get).toHaveBeenCalledTimes(1)
        expect(mocks.get).toHaveBeenCalledWith('/admin/stats', {
          days: expected
        })
      } else {
        expect(mocks.get).not.toHaveBeenCalled()
        expect(container.textContent).toContain('请输入 1 到 60 之间的整数天数')
      }
    }
  )

  it('clears old values on a new window and never lets stale responses win', async () => {
    const pending: Array<(value: OverviewData | string) => void> = []
    mocks.get.mockImplementation((url: string) => {
      if (url !== '/admin/stats') return Promise.resolve(okResponses[url])
      return new Promise<OverviewData | string>((resolve) =>
        pending.push(resolve)
      )
    })
    await render(4)
    await submitDays('30')
    expect(metric('新注册用户')).toBeNull()
    await submitDays('7')
    expect(pending).toHaveLength(3)
    await act(async () => pending[2]({ ...overviewData, newUser: 70 }))
    expect(metric('新注册用户')).toBe('70')
    await act(async () => pending[1]({ ...overviewData, newUser: 30 }))
    expect(metric('新注册用户')).toBe('70')
    await act(async () => pending[0](overviewData))
    expect(metric('新注册用户')).toBe('70')
  })

  it('masks private panels on downgrade and ignores late responses', async () => {
    let resolveSum!: (value: DashboardStatsSumData | string) => void
    let resolveLog!: (value: unknown) => void
    mocks.get.mockImplementation((url: string) => {
      if (url === '/admin/stats/sum') {
        return new Promise((resolve) => {
          resolveSum = resolve
        })
      }
      if (url === '/admin/log') {
        return new Promise((resolve) => {
          resolveLog = resolve
        })
      }
      return Promise.resolve(okResponses[url])
    })
    await render(4)
    expect(metric('新注册用户')).toBe('7')
    await act(async () => root.render(<DashboardStats reviewerRole={3} />))
    expect(panel('dashboard-sum-heading')).toBeNull()
    expect(panel('dashboard-log-heading')).toBeNull()
    expect(metric('新注册用户')).toBeNull()
    await act(async () => {
      resolveSum(sumData)
      resolveLog(okResponses['/admin/log'])
    })
    expect(metric('用户')).toBeNull()
    expect(container.textContent).not.toContain('资源申请通过')
  })

  it('requests private reads only after an upgrade to role 4', async () => {
    await render(3)
    for (const url of SUPER_ONLY) expect(requested()).not.toContain(url)
    await act(async () => root.render(<DashboardStats reviewerRole={4} />))
    expect(mocks.get).toHaveBeenCalledWith('/admin/stats/sum')
    expect(mocks.get).toHaveBeenCalledWith('/admin/stats', { days: 1 })
    expect(metric('用户')).toBe('120')
  })

  it('first render before any request shows skeletons, never failures', () => {
    const html = renderToStaticMarkup(<DashboardStats reviewerRole={4} />)
    expect(html).toContain('站点规模')
    expect(html).toContain('近期增长')
    expect(html).toContain('data-slot="skeleton"')
    expect(html).not.toContain('失败')
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('role 3 first render has no private panels at all', () => {
    const html = renderToStaticMarkup(<DashboardStats reviewerRole={3} />)
    expect(html).toContain('待办队列')
    expect(html).not.toContain('站点规模')
    expect(html).not.toContain('近期增长')
    expect(html).not.toContain('最近管理操作')
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('labels resource metrics with current terminology', async () => {
    await render(4)
    expect(metric('条目')).toBe('45')
    expect(metric('游戏资源')).toBe('67')
    expect(metric('补丁资源')).toBe('23')
    expect(metric('新增条目')).toBe('3')
    expect(metric('新增资源')).toBe('5')
    const creator = [...container.querySelectorAll('dt')].find(
      (el) => el.textContent === '创作者'
    )
    expect(creator?.parentElement?.textContent).toContain('不含管理员')
  })
})
